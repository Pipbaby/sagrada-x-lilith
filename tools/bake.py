# Bake the basilica's bounce light in Cycles, per vertex.
#
#   blender -b --factory-startup --python tools/bake.py -- [samples]
#
# Reads data/bake/in (exported by the app: basilica.exportBake()) and writes bake/
# its results:
#   sky.rgbe              sky light through windows and skylights, direct + bounced
#   sun-am/noon/pm.rgbe   bounced sunlight only (the renderer draws direct sun itself)
#   manifest.json         vertex counts per target, for the runtime check
# Values are irradiance / pi (Cycles' diffuse "light" term), RGBE-packed.
# Three.js is Y-up, Blender Z-up: (x, y, z) -> (x, -z, y).

import bpy
import json
import math
import os
import sys
import time
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
IN = os.path.join(ROOT, 'data', 'bake', 'in')
OUT = os.path.join(ROOT, 'bake')
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SAMPLES = int(args[0]) if args else 256

os.makedirs(OUT, exist_ok=True)
manifest = json.load(open(os.path.join(IN, 'manifest.json')))
blob = np.fromfile(os.path.join(IN, 'geometry.bin'), dtype=np.uint8)


def view(offset, count, dtype):
    return np.frombuffer(blob, dtype=dtype, count=count, offset=offset)


def to_blender(a):
    a = a.reshape(-1, 3)
    return np.stack([a[:, 0], -a[:, 2], a[:, 1]], axis=1).astype(np.float32)


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = SAMPLES
scene.cycles.max_bounces = 6
scene.cycles.diffuse_bounces = 4
scene.cycles.transparent_max_bounces = 16
scene.render.bake.target = 'VERTEX_COLORS'

# GPU if available
prefs = bpy.context.preferences.addons['cycles'].preferences
for kind in ('OPTIX', 'CUDA'):
    try:
        prefs.compute_device_type = kind
        prefs.get_devices()
        devices = [d for d in prefs.devices if d.type == kind]
        if devices:
            for d in prefs.devices:
                d.use = d.type == kind
            scene.cycles.device = 'GPU'
            print('Using', kind, [d.name for d in devices])
            break
    except Exception as e:
        print('no', kind, e)

materials = {}


def diffuse(albedo):
    key = tuple(round(c, 3) for c in albedo)
    if key not in materials:
        m = bpy.data.materials.new(f'diffuse-{len(materials)}')
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        bsdf = nt.nodes.new('ShaderNodeBsdfDiffuse')
        bsdf.inputs['Color'].default_value = (*key, 1)
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
        materials[key] = m
    return materials[key]


def glass_material(atlas):
    m = bpy.data.materials.new(f'glass-{atlas}')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(os.path.join(IN, f'glass-{atlas}.png'))
    tex.image.colorspace_settings.name = 'Non-Color'  # raw sRGB-encoded values, as the runtime curve expects
    gamma = nt.nodes.new('ShaderNodeGamma')
    gamma.inputs['Gamma'].default_value = 1.45
    mul = nt.nodes.new('ShaderNodeVectorMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = (1.3, 1.3, 1.3)
    mn = nt.nodes.new('ShaderNodeVectorMath')
    mn.operation = 'MINIMUM'
    mn.inputs[1].default_value = (0.92, 0.92, 0.92)
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    nt.links.new(tex.outputs['Color'], gamma.inputs['Color'])
    nt.links.new(gamma.outputs['Color'], mul.inputs[0])
    nt.links.new(mul.outputs['Vector'], mn.inputs[0])
    nt.links.new(mn.outputs['Vector'], tr.inputs['Color'])
    nt.links.new(tr.outputs['BSDF'], out.inputs['Surface'])
    return m


def build(entry, i):
    n = entry['vertexCount']
    pos = to_blender(view(entry['positions'], n * 3, np.float32))
    if 'index' in entry:
        idx = view(entry['index'], entry['indexCount'], np.uint32).astype(np.int32)
    else:
        idx = np.arange(n, dtype=np.int32)
    tris = len(idx) // 3
    mesh = bpy.data.meshes.new(f"{entry['role']}-{i}")
    mesh.vertices.add(n)
    mesh.vertices.foreach_set('co', pos.ravel())
    mesh.loops.add(len(idx))
    mesh.loops.foreach_set('vertex_index', idx)
    mesh.polygons.add(tris)
    mesh.polygons.foreach_set('loop_start', np.arange(0, len(idx), 3, dtype=np.int32))
    mesh.update(calc_edges=True)
    if entry['role'] == 'glass':
        uv = view(entry['uv'], n * 2, np.float32).reshape(-1, 2)
        layer = mesh.uv_layers.new(name='uv')
        layer.data.foreach_set('uv', uv[idx].ravel())
        mesh.materials.append(glass_material(entry['atlas']))
    else:
        mesh.materials.append(diffuse(entry.get('albedo', [0.5, 0.5, 0.5])))
        nor = to_blender(view(entry['normals'], n * 3, np.float32))
        mesh.shade_smooth()
        try:
            mesh.normals_split_custom_set_from_vertices(nor)
        except Exception as e:
            print('normals', i, e)
    obj = bpy.data.objects.new(mesh.name, mesh)
    scene.collection.objects.link(obj)
    return obj


t0 = time.time()
targets = []
for i, entry in enumerate(manifest['meshes']):
    obj = build(entry, i)
    if entry['role'] == 'target':
        attr = obj.data.color_attributes.new('bake', 'FLOAT_COLOR', 'POINT')
        obj.data.attributes.active_color = attr
        targets.append((entry, obj))
print(f'built {len(manifest["meshes"])} meshes in {time.time() - t0:.1f}s')

world = bpy.data.worlds.new('sky')
world.use_nodes = True
background = world.node_tree.nodes['Background']
scene.world = world
sun_data = bpy.data.lights.new('sun', 'SUN')
sun_data.angle = math.radians(0.53)
sun = bpy.data.objects.new('sun', sun_data)
scene.collection.objects.link(sun)

for obj in scene.objects:
    obj.select_set(False)
for _, obj in targets:
    obj.select_set(True)
bpy.context.view_layer.objects.active = targets[0][1]


def smooth(entry, rgb, iterations=2):
    # Per-vertex Monte Carlo noise: weld vertices that share a position, then
    # blend each value with its neighbours along the surface's edges.
    n = entry['vertexCount']
    pos = view(entry['positions'], n * 3, np.float32).reshape(-1, 3)
    key = np.round(pos * 500).astype(np.int64)  # 2 mm
    _, weld = np.unique(key, axis=0, return_inverse=True)
    weld = weld.ravel()
    if 'index' in entry:
        idx = view(entry['index'], entry['indexCount'], np.uint32).astype(np.int64)
    else:
        idx = np.arange(n, dtype=np.int64)
    tri = weld[idx].reshape(-1, 3)
    edges = np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]])
    edges = np.concatenate([edges, edges[:, ::-1]])
    m = weld.max() + 1
    # value per welded vertex = mean of its duplicates
    val = np.zeros((m, 3))
    cnt = np.zeros(m)
    np.add.at(val, weld, rgb)
    np.add.at(cnt, weld, 1)
    val /= np.maximum(cnt, 1)[:, None]
    deg = np.bincount(edges[:, 0], minlength=m).astype(np.float64)
    for _ in range(iterations):
        acc = np.zeros((m, 3))
        np.add.at(acc, edges[:, 0], val[edges[:, 1]])
        nb = acc / np.maximum(deg, 1)[:, None]
        val = np.where(deg[:, None] > 0, 0.5 * val + 0.5 * nb, val)
    return val[weld].astype(np.float32)


def bake(name, pass_filter):
    t = time.time()
    bpy.ops.object.bake(type='DIFFUSE', pass_filter=pass_filter)
    parts = []
    for entry, obj in targets:
        n = entry['vertexCount']
        rgba = np.zeros(n * 4, dtype=np.float32)
        obj.data.color_attributes['bake'].data.foreach_get('color', rgba)
        parts.append(smooth(entry, rgba.reshape(-1, 4)[:, :3]))
    rgb = np.concatenate(parts)
    # RGBE: shared exponent, 8-bit mantissas
    m = np.maximum(rgb.max(axis=1), 1e-9)
    e = np.ceil(np.log2(m))
    scale = np.exp2(8 - e)
    packed = np.zeros((len(rgb), 4), dtype=np.uint8)
    packed[:, :3] = np.clip(np.round(rgb * scale[:, None]), 0, 255)
    packed[:, 3] = np.clip(e + 128, 0, 255)
    packed[rgb.max(axis=1) < 1e-6] = 0
    packed.tofile(os.path.join(OUT, f'{name}.rgbe'))
    print(f'baked {name}: {len(rgb)} vertices, mean {rgb.mean(axis=0)}, {time.time() - t:.1f}s', flush=True)


# 1. sky: world light only (direct through windows and skylights + bounces)
sky = manifest['sky']
background.inputs['Color'].default_value = (*sky, 1)
background.inputs['Strength'].default_value = 1.0
sun_data.energy = 0.0
sun.hide_render = True
bake('sky', {'DIRECT', 'INDIRECT'})

# 2. sun samples: bounced sunlight only
background.inputs['Strength'].default_value = 0.0
sun.hide_render = False
for s in manifest['sun']:
    d = np.array(s['dir'], dtype=np.float64)
    d = np.array([d[0], -d[2], d[1]])  # to Blender axes
    d /= np.linalg.norm(d)
    # the lamp shines along its local -Z: point local +Z at the sun
    z = d
    x = np.cross([0, 0, 1], z) if abs(z[2]) < 0.999 else np.array([1.0, 0, 0])
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    from mathutils import Matrix
    sun.matrix_world = Matrix(((x[0], y[0], z[0], 0), (x[1], y[1], z[1], 0), (x[2], y[2], z[2], 0), (0, 0, 0, 1)))
    color = np.array(s['color'])
    k = float(color.max())
    sun_data.color = tuple(color / k)
    sun_data.energy = k
    bake(f"sun-{s['key']}", {'INDIRECT'})

json.dump({
    'version': 1,
    'baked': time.strftime('%Y-%m-%dT%H:%M:%S'),
    'samples': SAMPLES,
    'targets': [e['vertexCount'] for e, _ in targets],
    'targetVertices': int(sum(e['vertexCount'] for e, _ in targets)),
    'sky': sky,
    'sun': [{k: s[k] for k in ('key', 'hour', 'day', 'dir', 'color')} for s in manifest['sun']],
    'source': manifest['created'],
}, open(os.path.join(OUT, 'manifest.json'), 'w'))
print('DONE', time.time() - t0)
