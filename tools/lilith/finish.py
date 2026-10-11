# Lilith, last pass towards the series (2026-10-09), on top of soften.py's result:
#   - head and neck smoothed like the torso (the original's head is a smooth hood);
#   - mask repainted: lilac purple, the inverted Seele triangle around the seven eyes, the
#     pock marks gathered at the top;
#   - cross repainted: clean bright red with a network of fine dark cracks; the painted LCL
#     smear goes (real streams replace it);
#   - nails: hexagonal bolt heads instead of round discs;
#   - two LCL streams, orange, running from under the body down the front of the post.
# Textures are repainted in object space: every texel is given the 3D point it covers
# (rasterised through the UVs), and the pattern is computed there, so it has no seams.
#
#   blender -b --factory-startup --python tools/lilith/finish.py -- <in.glb> <out.glb> <renderdir>
import bpy, bmesh, os, sys, math, time
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
src, dst, rdir = args
os.makedirs(rdir, exist_ok=True)
rng = np.random.default_rng(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.data.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print('objects:', sorted({o.name.split('.')[0] for o in meshes}), flush=True)


def matname(o):
    return o.data.materials[0].name if o.data.materials else ''


def pick(key):
    return [o for o in meshes if key in o.name or key in matname(o)]


body = [o for o in meshes if 'LilithBody' in o.name or matname(o) == 'Body'][0]
mask = pick('Mask')
eyes = [o for o in meshes if 'eye' in o.name.lower()]
stone = pick('Stone')
nails = [o for o in meshes if 'Metal' in matname(o) or 'Cylinder' in o.name]
print('body', body.name, 'mask', len(mask), 'eyes', len(eyes), 'stone', len(stone), 'nails', len(nails), flush=True)


def coords(mesh):
    a = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
    mesh.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


def s(v, a, b):
    t = np.clip((v - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ head and neck
p = coords(body.data)
crown = p[np.argmax(np.where(np.abs(p[:, 0]) < 1.8, p[:, 2], -99))]
w = s(p[:, 2], 0.25, 0.6) * (1 - s(np.abs(p[:, 0] - crown[0] * 0.5), 1.3, 1.8))
vg = body.vertex_groups.new(name='head')
for val in np.unique(np.round(w[w > 0.001], 3)):
    vg.add([int(i) for i in np.nonzero(np.abs(w - val) < 0.0005)[0]], float(val), 'REPLACE')
m = body.modifiers.new('head', 'LAPLACIANSMOOTH')
m.vertex_group = 'head'
m.iterations = 50
m.lambda_factor = 1.0
m.lambda_border = 0
m.use_volume_preserve = True
m.use_normalized = True
bpy.context.view_layer.objects.active = body
bpy.ops.object.modifier_apply(modifier='head')
print('head smoothed; crown at', crown.round(2), flush=True)


# ------------------------------------------------------------------ texture painting
def rasterise(objs, size):
    """Per texel: the 3D point it shows (and whether any triangle covers it)."""
    pos = np.zeros((size, size, 3), np.float32)
    nrm = np.zeros((size, size, 3), np.float32)
    hit = np.zeros((size, size), np.int16)
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        uvl = me.uv_layers.active.data
        uv = np.empty(len(uvl) * 2)
        uvl.foreach_get('uv', uv)
        uv = uv.reshape(-1, 2)
        co = coords(me)
        vn = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get('normal', vn)
        vn = vn.reshape(-1, 3)
        for t in me.loop_triangles:
            L = list(t.loops)
            V = list(t.vertices)
            T = uv[L] * size  # texel coordinates (y up)
            T[:, 1] = size - T[:, 1]
            x0, y0 = np.floor(T.min(0)).astype(int)
            x1, y1 = np.ceil(T.max(0)).astype(int)
            x0, y0 = max(x0, 0), max(y0, 0)
            x1, y1 = min(x1, size - 1), min(y1, size - 1)
            if x1 < x0 or y1 < y0:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            (ax, ay), (bx, by), (cx, cy) = T
            d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(d) < 1e-12:
                continue
            l0 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / d
            l1 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / d
            l2 = 1 - l0 - l1
            e = -0.6 / max(1.0, math.sqrt(abs(d)))  # a little dilation over the seams
            inside = (l0 >= e) & (l1 >= e) & (l2 >= e)
            if not inside.any():
                continue
            P = l0[..., None] * co[V[0]] + l1[..., None] * co[V[1]] + l2[..., None] * co[V[2]]
            N = l0[..., None] * vn[V[0]] + l1[..., None] * vn[V[1]] + l2[..., None] * vn[V[2]]
            yy, xx = np.nonzero(inside)
            pos[y0 + yy, x0 + xx] = P[yy, xx]
            nrm[y0 + yy, x0 + xx] = N[yy, xx]
            hit[y0 + yy, x0 + xx] += 1
    # fill the gutters from the nearest painted texel, so mipmaps don't bleed in old colour
    for _ in range(12):
        empty = hit == 0
        if not empty.any():
            break
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            src_hit = np.roll(np.roll(hit, dy, 0), dx, 1)
            take = empty & (src_hit > 0)
            pos[take] = np.roll(np.roll(pos, dy, 0), dx, 1)[take]
            nrm[take] = np.roll(np.roll(nrm, dy, 0), dx, 1)[take]
            hit[take] = -1
            empty = hit == 0
    return pos, nrm, hit


def image_for(objs, kind):
    """The image node feeding the material's base colour (kind 'color') or normal ('normal')."""
    mat = objs[0].data.materials[0]
    for n in mat.node_tree.nodes:
        if n.type != 'TEX_IMAGE':
            continue
        for l in n.outputs['Color'].links:
            to = l.to_node
            if kind == 'color' and l.to_socket.name == 'Base Color':
                return n
            if kind == 'normal' and to.type == 'NORMAL_MAP':
                return n
            if kind == 'rough' and to.type == 'SEPARATE_COLOR':
                return n
    return None


def write_image(node, rgb, name):
    """Save the painted texture as a PNG beside the renders and load it into the material."""
    size = rgb.shape[0]
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    px = np.ones((size, size, 4), np.float32)
    px[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(px[::-1].ravel())  # Blender stores rows bottom-up
    path = os.path.join(rdir, name + '.png')
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    loaded = bpy.data.images.load(path)
    loaded.colorspace_settings.name = node.image.colorspace_settings.name
    loaded.pack()
    node.image = loaded


def srgb_to_lin(c):
    c = np.asarray(c, np.float32) / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.clip(c, 0, None), 1 / 2.4) - 0.055)


def read_pixels(node):
    img = node.image
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)[::-1, :, :3]  # top row first, display values


def value_noise(P, scale, seed):
    """Smooth 3D value noise in [0, 1]."""
    g = P / scale
    i = np.floor(g).astype(np.int64)
    f = g - i
    f = f * f * (3 - 2 * f)

    def h(ix, iy, iz):
        n = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
        n = (n ^ (n >> 13)) * 1274126177
        return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0

    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                wgt = (f[..., 0] if dx else 1 - f[..., 0]) * (f[..., 1] if dy else 1 - f[..., 1]) * (f[..., 2] if dz else 1 - f[..., 2])
                out = out + wgt * h(i[..., 0] + dx, i[..., 1] + dy, i[..., 2] + dz)
    return out


def voronoi_edge(P, cell, seed):
    """Distance to the nearest cell border of a jittered 3D Voronoi (F2 - F1)."""
    g = P / cell
    i = np.floor(g).astype(np.int64)
    f1 = np.full(P.shape[:-1], 9.0)
    f2 = np.full(P.shape[:-1], 9.0)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                c = i + np.array([dx, dy, dz])
                n = (c[..., 0] * 73856093) ^ (c[..., 1] * 19349663) ^ (c[..., 2] * 83492791) ^ (seed * 2654435761)
                j = np.stack([((n >> k) & 0x3FF) / 1023.0 for k in (0, 10, 20)], -1)
                d = np.linalg.norm(c + 0.15 + 0.7 * j - g, axis=-1)
                f2 = np.where(d < f1, f1, np.minimum(f2, d))
                f1 = np.minimum(f1, d)
    return (f2 - f1) * cell


# ------------------------------------------------------------------ mask
t0 = time.time()
mcol = image_for(mask, 'color')
size = min(2048, mcol.image.size[0])
mpos, mnrm, mhit = rasterise(mask, size)
E = np.array([sum((o.matrix_world @ Vector(c) for c in o.bound_box), Vector()) / 8 for o in eyes])
centre = E.mean(0)
# the mask's frame: n out of the face, u across the eye columns, v up along them
near = np.linalg.norm(mpos - centre, axis=-1) < 0.35
n_out = mnrm[near & (mhit != 0)].mean(0)
n_out /= np.linalg.norm(n_out)
Q = E - centre
Q -= np.outer(Q @ n_out, n_out)
# the two eye columns (four and three eyes, as the sculptor named them); "up" runs along them
four = np.array([any(k in o.name for k in ('001', '003', '004', '005')) for o in eyes])
dirs = []
for grp in (four, ~four):
    G = Q[grp] - Q[grp].mean(0)
    d = np.linalg.svd(G)[2][0]
    if dirs and d @ dirs[0] < 0:
        d = -d
    dirs.append(d)
v_axis = dirs[0] * four.sum() + dirs[1] * (~four).sum()
v_axis -= (v_axis @ n_out) * n_out
v_axis /= np.linalg.norm(v_axis)
if (crown - centre) @ v_axis < 0:
    v_axis = -v_axis
u_axis = np.cross(v_axis, n_out)
# u to the viewer's right, the side of the four-eye column
if (Q[four].mean(0) - Q[~four].mean(0)) @ u_axis < 0:
    u_axis = -u_axis
eu, ev = Q @ u_axis, Q @ v_axis
print('eyes (u, v):', np.round(np.c_[eu, ev], 2).tolist(), flush=True)
# the inverted triangle: top edge above the highest eye, apex below the lowest
R0 = mpos[mhit != 0] - centre
mv = R0 @ v_axis
print('mask extent along v', round(float(mv.min()), 2), round(float(mv.max()), 2), flush=True)
top, apex_v = ev.max() + 0.085, max(float(np.percentile(mv, 1)) + 0.1, ev.min() - 0.6)
uc = (eu.max() + eu.min()) / 2 + 0.02
need = 0
for a, b in zip(eu, ev):
    k = (b - apex_v) / (top - apex_v)
    need = max(need, (abs(a - uc) + 0.075) / max(k, 1e-3))
half = need * 1.03
tri = np.array([[uc - half, top], [uc + half, top], [uc, apex_v]])
R = mpos - centre
U, V = R @ u_axis, R @ v_axis


def seg_dist(px, py, a, b):
    ab = b - a
    t = np.clip(((px - a[0]) * ab[0] + (py - a[1]) * ab[1]) / (ab @ ab), 0, 1)
    return np.hypot(px - (a[0] + t * ab[0]), py - (a[1] + t * ab[1]))


line = np.minimum.reduce([seg_dist(U, V, tri[i], tri[(i + 1) % 3]) for i in range(3)])
old = read_pixels(mcol)
lum = old.mean(-1)
grain = lum / max(np.median(lum[mhit != 0]), 1e-3)
height = (V - ev.max()) / 0.35  # 0 at the top eye, 1 well above it
upper = s(height, -0.6, 0.4)
# lilac purple, a little lighter at the top; the old mottling only on the upper part
base = srgb_to_lin([138, 98, 160]) * (1.0 + 0.10 * s(V, ev.min(), top + 0.3)[..., None])
var = 1 + (np.clip(grain, 0.5, 1.6) - 1) * (0.25 + 0.75 * upper)
col = base * var[..., None]
# pock marks: little craters scattered over the top, thinning out down to the eyes
ncr = 260
cu = rng.uniform(U[mhit != 0].min(), U[mhit != 0].max(), ncr)
cv = ev.max() - 0.12 + rng.power(0.55, ncr) * (V[mhit != 0].max() - ev.max() + 0.12)
cr = rng.uniform(0.012, 0.045, ncr)
shade = np.zeros(U.shape)
for a, b, r in zip(cu, cv, cr):
    d = np.hypot(U - a, V - b) / r
    inside = d < 1.25
    if not inside.any():
        continue
    # dark floor, lit lower lip, dark rim: a small crater lit from above
    lip = np.clip(1 - np.abs(d - 1) * 6, 0, 1)
    floor = np.clip(1 - d, 0, 1)
    side = np.clip(((V - b) / r), -1, 1)
    shade += inside * (-0.35 * floor - 0.25 * lip * (side > 0) + 0.18 * lip * (side <= 0))
col *= np.clip(1 + shade, 0.35, 1.4)[..., None]
# the Seele triangle, a thin dark line
ink = np.clip(1 - (line - 0.005) / 0.005, 0, 1)
col = col * (1 - ink[..., None]) + srgb_to_lin([52, 26, 64]) * ink[..., None]
write_image(mcol, lin_to_srgb(col), 'MaskSeele')
print('mask painted in', round(time.time() - t0), 's; triangle', np.round(tri, 2).tolist(), flush=True)

# ------------------------------------------------------------------ cross
t0 = time.time()
scol = image_for(stone, 'color')
size = min(4096, scol.image.size[0])
spos, snrm, shit = rasterise(stone, size)
P = spos.astype(np.float64)
# the cross is about 23 model units for 34 m: cells of ~2 m, finer cracks between
edge1 = voronoi_edge(P, 1.45, 3)
edge2 = voronoi_edge(P, 0.55, 11)
crack = np.clip(1 - (edge1 - 0.006) / 0.012, 0, 1) + 0.55 * np.clip(1 - (edge2 - 0.003) / 0.008, 0, 1) * (value_noise(P, 1.2, 5) > 0.55)
crack = np.clip(crack, 0, 1)
tone = 0.93 + 0.14 * value_noise(P, 2.5, 2) + 0.05 * value_noise(P, 0.4, 9)
red = srgb_to_lin([200, 28, 24]) * tone[..., None]
col = red * (1 - 0.75 * crack[..., None]) + srgb_to_lin([70, 6, 6]) * 0.75 * crack[..., None]
write_image(scol, lin_to_srgb(col), 'CrossRed')
nrm_node = image_for(stone, 'normal')
if nrm_node:
    nm = read_pixels(nrm_node) * 2 - 1
    nm[..., :2] *= 0.15  # keep a trace of the stone, mostly flat like the painted cross
    nm /= np.linalg.norm(nm, axis=-1, keepdims=True)
    write_image(nrm_node, nm * 0.5 + 0.5, 'CrossNormal')
mat = stone[0].data.materials[0]
bsdf = [n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'][0]
rough_link = bsdf.inputs['Roughness'].links
for l in list(rough_link) + list(bsdf.inputs['Metallic'].links):
    mat.node_tree.links.remove(l)
bsdf.inputs['Roughness'].default_value = 0.55
bsdf.inputs['Metallic'].default_value = 0.0
print('cross painted in', round(time.time() - t0), 's', flush=True)

# ------------------------------------------------------------------ nails
metal = nails[0].data.materials[0] if nails and nails[0].data.materials else None
for o in nails:
    c = coords(o.data)
    lo, hi = c.min(0), c.max(0)
    axis = int(np.argmax(hi - lo))  # the long side is the nail's shaft
    others = [k for k in range(3) if k != axis]
    r = float(np.mean([(hi[k] - lo[k]) / 2 for k in others]))
    centre_xs = (lo + hi) / 2
    # the head is at the front (towards -y, the figure's front) end of the shaft
    front, back = (lo[axis], hi[axis]) if axis == 1 else (hi[axis], lo[axis])
    bm = bmesh.new()
    head_d = 0.13
    shaft_r = r * 0.6
    for (radius, a0, a1, segs) in [(r * 1.35, front, front + head_d, 6), (shaft_r, front + head_d, back, 12)]:
        geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=radius, radius2=radius, depth=abs(a1 - a0))
        vs = geom['verts']
        mid = (a0 + a1) / 2
        for v in vs:
            # create_cone builds along z; turn it onto the nail's axis
            x, y, z = v.co
            p = [centre_xs[0], centre_xs[1], centre_xs[2]]
            local = [x, y]
            p[axis] = mid + z
            p[others[0]] += local[0]
            p[others[1]] += local[1]
            v.co = Vector(p)
    bm.normal_update()
    o.data.clear_geometry()
    bm.to_mesh(o.data)
    bm.free()
    for poly in o.data.polygons:
        poly.use_smooth = False
print('nails rebuilt as hexagonal bolts', flush=True)

# ------------------------------------------------------------------ LCL streams
S = np.concatenate([coords(o.data) for o in stone])
lowpost = S[(S[:, 2] < -9) & (S[:, 2] > -15)]
px0, px1 = np.percentile(lowpost[:, 0], 1), np.percentile(lowpost[:, 0], 99)
y_front = np.percentile(lowpost[:, 1], 1)
z_bottom = S[:, 2].min()
W = px1 - px0
pb = coords(body.data)
z_top = np.percentile(pb[:, 2], 3) + 1.2  # start up behind the lumpy lower body
print('post x', round(px0, 2), round(px1, 2), 'front y', round(y_front, 2), 'z', round(z_bottom, 2), '..', round(z_top, 2), flush=True)
lcl = bpy.data.materials.new('LCL')
lcl.use_nodes = True
b = lcl.node_tree.nodes['Principled BSDF']
b.inputs['Base Color'].default_value = (0.85, 0.30, 0.04, 1)
b.inputs['Roughness'].default_value = 0.12
b.inputs['Emission Color'].default_value = (1.0, 0.42, 0.08, 1)
b.inputs['Emission Strength'].default_value = 0.35
streams = []
for (cx, width, seed) in [(0.51, 0.045, 1), (0.62, 0.16, 2)]:
    bm = bmesh.new()
    rows = []
    n_z, n_x = 160, 9
    for k in range(n_z + 1):
        z = z_top + (z_bottom - z_top) * k / n_z
        t = k / n_z
        wob = 1 + 0.12 * math.sin(z * 2.3 + seed) + 0.06 * math.sin(z * 7.1 + 2 * seed)
        wdt = W * width * wob * (0.8 + 0.2 * min(1, t * 6))
        xc = px0 + W * cx + 0.02 * W * math.sin(z * 0.9 + seed)
        row = []
        for j in range(n_x):
            a = j / (n_x - 1)  # across the stream
            x = xc + (a - 0.5) * wdt
            bulge = 0.05 * math.sin(math.pi * a) * min(1.0, wdt / 0.3)
            row.append(bm.verts.new((x, y_front - 0.01 - bulge, z)))
        rows.append(row)
    for k in range(n_z):
        for j in range(n_x - 1):
            bm.faces.new((rows[k][j], rows[k][j + 1], rows[k + 1][j + 1], rows[k + 1][j]))
    me = bpy.data.meshes.new(f'LCL{seed}')
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    ob = bpy.data.objects.new(f'LCL_stream_{seed}', me)
    me.materials.append(lcl)
    bpy.context.scene.collection.objects.link(ob)
    streams.append(ob)
# face the streams outwards (towards -y)
for ob in streams:
    me = ob.data
    if np.mean([p.normal.y for p in me.polygons]) > 0:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()

# ------------------------------------------------------------------ check renders
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 1100, 1100
world = bpy.data.worlds.new('w')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.02, 0.02, 0.025, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
sc.world = world
sunl = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sunl.data.energy = 3.5
sunl.rotation_euler = (math.radians(55), 0, math.radians(-25))
sc.collection.objects.link(sunl)
fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'SUN'))
fill.data.energy = 1.0
fill.rotation_euler = (math.radians(70), 0, math.radians(160))
sc.collection.objects.link(fill)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam)
sc.camera = cam
mc = centre
views = [
    ('front', (0, -40, -5.5), (0, 0, -5.5), 50),
    ('upper', (0, -16, 0.2), (0, 0, -0.5), 50),
    ('mask', tuple(mc + n_out * 2.6 + v_axis * 0.2), tuple(mc), 50),
    ('nail', (5.2, -3.5, 1.2), (4.9, 0, 0.85), 50),
    ('foot', (1.5, -15, -10), (0, 0, -9.5), 50),
]
for name, loc, look, lens in views:
    cam.location = loc
    cam.data.lens = lens
    cam.rotation_euler = (Vector(look) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(rdir, f'finish-{name}.png')
    bpy.ops.render.render(write_still=True)
for o in (sunl, fill, cam):
    bpy.data.objects.remove(o)

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=90, export_apply=True)
print('exported', dst, os.path.getsize(dst) // 1000000, 'MB', flush=True)
