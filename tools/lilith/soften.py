# Lilith A: soften the human musculature of the arms and ribcage, keep the head, mask and the
# root-like lower body as sculpted; render comparison views; optionally export a lighter .glb.
#
#   blender -b --factory-startup --python tools/lilith/soften.py -- <in.glb> <outdir> <settings> [export.glb]
# settings: comma-separated iterations:lambda[:roots], e.g. 0:0,60:1,60:1:1.8 (0:0 = not
# smoothed; roots = how much further the root-like limbs of the lower body reach, 1 = as sculpted); each is
# rendered; the last one is exported. The figure is first reduced to its final size (~260 k
# triangles): smoothing away forms as large as the muscles needs many passes, which only
# runs in reasonable time on the lighter mesh.
#
# Blender axes after import: x across (arms), z up, the figure faces -y.
# Strength per vertex (0..1): arms from the shoulder out (lighter on the hands), the torso from
# the shoulders down to the waist; fades out over the neck and head and into the lower body.
import bpy, bmesh, os, sys, math
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
src, outdir = args[0], args[1]
settings = [(int(p[0]), float(p[1]), float(p[2]) if len(p) > 2 else 1.0) for p in (x.split(':') for x in args[2].split(','))]
export = args[3] if len(args) > 3 else None
os.makedirs(outdir, exist_ok=True)


def s(v, a, b):
    t = min(1.0, max(0.0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)


def strength(p):
    ax = abs(p.x)
    arms = s(ax, 1.35, 1.95) * (1 - s(ax, 3.7, 4.25))  # the hands stay as sculpted
    torso = (1 - s(ax, 1.5, 2.0)) * s(p.z, -2.95, -2.45) * (1 - s(p.z, 0.25, 0.75))
    head = s(p.z, 0.45, 0.85) * (1 - s(ax, 1.6, 2.2))
    return max(arms, torso) * (1 - head)


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
bodies = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('Body')]
bpy.ops.object.select_all(action='DESELECT')
for o in bodies:
    o.select_set(True)
bpy.context.view_layer.objects.active = bodies[0]
bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = 'LilithBody'
# into world space: the import hangs the meshes under scaled, rotated parents, so without
# this the strength zones below land in the wrong places
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
# the glTF chunks share their seams: weld them (in metres) so smoothing doesn't open cracks
bm = bmesh.new()
bm.from_mesh(body.data)
n0 = len(bm.verts)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-4)
print('welded', n0 - len(bm.verts), 'seam vertices; open edges left:', sum(1 for e in bm.edges if e.is_boundary), flush=True)
bm.to_mesh(body.data)
bm.free()
co = [v.co for v in body.data.vertices]
print('extent x', round(min(c.x for c in co), 2), round(max(c.x for c in co), 2), 'z', round(min(c.z for c in co), 2), round(max(c.z for c in co), 2), flush=True)
d = body.modifiers.new('decimate', 'DECIMATE')
d.ratio = 260000 / len(body.data.polygons)
bpy.context.view_layer.objects.active = body
bpy.ops.object.modifier_apply(modifier='decimate')
print('body', len(body.data.vertices), 'verts', len(body.data.polygons), 'faces', flush=True)

vg = body.vertex_groups.new(name='soften')
weights = {}
for v in body.data.vertices:
    w = strength(v.co)
    if w > 0.001:
        weights.setdefault(round(w, 3), []).append(v.index)
for w, idx in weights.items():
    vg.add(idx, w, 'REPLACE')


def render_views(tag):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'SINGLE'
    sc.display.shading.single_color = (0.86, 0.85, 0.83)
    sc.display.shading.show_cavity = True
    sc.render.resolution_x, sc.render.resolution_y = 1100, 1100
    cam = bpy.data.objects.get('cmp-cam')
    if not cam:
        cam = bpy.data.objects.new('cmp-cam', bpy.data.cameras.new('cmp-cam'))
        sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = 'PERSP'
    cam.data.lens = 50
    for name, loc, look in [
        ('front', (0, -15, -0.9), (0, 0, -0.9)),
        ('three-quarter', (-9, -11, -0.6), (0, 0, -0.9)),
        ('side', (13, -2, -1.2), (0, 0, -1.2)),
        ('back', (0, 14, -0.9), (0, 0, -0.9)),
        ('arm', (5.0, -6.5, 0.6), (3.0, 0, 0.5)),
        ('roots', (-2.5, -8.5, -4.6), (0, 0, -4.4)),
        ('roots-side', (8.5, -1.5, -4.8), (0, 0, -4.5)),
    ]:
        cam.location = loc
        d = Vector(look) - Vector(loc)
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(outdir, f'{tag}-{name}.png')
        bpy.ops.render.render(write_still=True)


# only the figure in the renders
hidden = [o for o in bpy.data.objects if o.type == 'MESH' and not any(k in o.name for k in ('LilithBody', 'Mask', 'eye'))]
for o in hidden:
    o.hide_render = True
import time
import numpy as np


def coords(mesh):
    a = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


# The lower body seen from its own centre: in each direction the trunk's surface is where most
# of the surface is (a low percentile of the distances); the limbs are the few points that reach
# much further out. Growing them = stretching that reach, with a droop, leaving the trunk alone.
base = coords(body.data)
lower = base[:, 2] < -2.8
centre = base[lower].mean(0)
print('lower body centre', centre.round(2), flush=True)
NA, NP = 48, 24  # direction bins: around, and from top to bottom


def bins(p):
    v = p - centre
    r = np.linalg.norm(v, axis=1) + 1e-9
    az = ((np.arctan2(v[:, 1], v[:, 0]) + np.pi) / (2 * np.pi) * NA).astype(int) % NA
    po = np.clip((np.arccos(np.clip(v[:, 2] / r, -1, 1)) / np.pi * NP).astype(int), 0, NP - 1)
    return r, az, po


r0, az0, po0 = bins(base)
R = np.full((NA, NP), np.nan)
for a in range(NA):
    for q in range(NP):
        sel = lower & (az0 == a) & (po0 == q)
        if sel.sum() > 20:
            R[a, q] = np.percentile(r0[sel], 35)
# fill empty bins and soften the map so neighbouring directions agree
for _ in range(6):
    pad = np.pad(R, ((1, 1), (1, 1)), mode='wrap')
    stack = np.stack([pad[1 + da:NA + 1 + da, 1 + dq:NP + 1 + dq] for da in (-1, 0, 1) for dq in (-1, 0, 1)])
    R = np.where(np.isnan(R), np.nanmean(stack, 0), 0.5 * R + 0.5 * np.nanmean(stack, 0))
R = np.nan_to_num(R, nan=np.nanmean(R))
reach = r0 - R[az0, po0]  # how far a point stands out beyond the trunk in its direction


def grow_roots(mesh, k):
    """Stretch the limbs of the lower body k times as far out from the trunk, drooping a little."""
    if k == 1.0:
        return
    p = coords(mesh)
    below = np.clip((-3.05 - p[:, 2]) / 0.55, 0, 1)  # from below the trunk's upper folds
    limb = np.clip((reach - 0.12) / 0.18, 0, 1)  # limbs reach far; the trunk's round lumps only a little
    w = below * limb
    out = np.clip(reach, 0, None)
    v = p - centre
    unit = v / (np.linalg.norm(v, axis=1)[:, None] + 1e-9)
    new = p + unit * (out * (k - 1) * w)[:, None]
    new[:, 2] -= 0.4 * (k - 1) * w * out  # hanging, like roots
    mesh.vertices.foreach_set('co', new.astype(np.float32).ravel())
    mesh.update()
    print('roots', k, 'moved', int((w > 0.01).sum()), 'vertices; max reach', round(float(out.max()), 2), flush=True)


original = body.data.copy()
for iters, lam, roots in settings:
    body.data = original.copy()
    grow_roots(body.data, roots)
    if iters:
        m = body.modifiers.new('soften', 'LAPLACIANSMOOTH')
        m.vertex_group = 'soften'
        m.iterations = iters
        m.lambda_factor = lam
        m.lambda_border = 0
        m.use_volume_preserve = True
        m.use_normalized = True
        bpy.context.view_layer.objects.active = body
        t0 = time.time()
        bpy.ops.object.modifier_apply(modifier='soften')
        print('smoothed', iters, lam, 'in', round(time.time() - t0), 's', flush=True)
    render_views('before' if not iters and roots == 1 else f'it{iters}-l{lam}-r{roots}')

if export:
    for o in hidden:
        o.hide_render = False
    # lighter for the basilica: ~300 k triangles for the figure, the rest in proportion
    # budgets per part (the mask and the stone cross come in several pieces)
    budgets = {'Mask': 45000, 'Stone': 45000}
    parts = {k: [o for o in bpy.data.objects if o.type == 'MESH' and k in o.name] for k in budgets}
    for k, objs in parts.items():
        total = sum(len(o.data.polygons) for o in objs)
        for o in objs:
            if total > budgets[k]:
                d = o.modifiers.new('decimate', 'DECIMATE')
                d.ratio = budgets[k] / total
                bpy.context.view_layer.objects.active = o
                bpy.ops.object.modifier_apply(modifier='decimate')
    total = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    print('faces after decimation', total)
    bpy.ops.export_scene.gltf(filepath=export, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=90, export_apply=True)
    print('exported', export, os.path.getsize(export) // 1000000, 'MB')
