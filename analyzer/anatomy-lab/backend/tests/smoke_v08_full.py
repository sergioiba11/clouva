from types import SimpleNamespace
import numpy as np
import trimesh

from body_measurements import calculate_body_measurements
from garment_anchors import build_garment_anchors

# Simple closed humanoid-ish body: torso + head + four limbs.
parts=[]
def add(mesh, translation):
    mesh=mesh.copy(); mesh.apply_translation(translation); parts.append(mesh)
add(trimesh.creation.cylinder(radius=.18,height=.65,sections=48), [0,0,.85])
add(trimesh.creation.icosphere(subdivisions=2,radius=.18), [0,0,1.42])
add(trimesh.creation.cylinder(radius=.055,height=.75,sections=32), [-.29,0,.93])
add(trimesh.creation.cylinder(radius=.055,height=.75,sections=32), [.29,0,.93])
add(trimesh.creation.cylinder(radius=.07,height=.78,sections=32), [-.10,0,.39])
add(trimesh.creation.cylinder(radius=.07,height=.78,sections=32), [.10,0,.39])
mesh=trimesh.util.concatenate(parts)
vertices=np.asarray(mesh.vertices,float); faces=np.asarray(mesh.faces,int)
triangles=vertices[faces]
normals=np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0]); normals/=np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-12)
class Record:
    def __init__(self):
        self.vertices_canonical=vertices; self.faces=faces
class Scene:
    pass
scene=Scene(); scene.vertices=vertices; scene.faces=faces
scene.bounds_min=vertices.min(0); scene.bounds_max=vertices.max(0)
scene.face_geometry_ids=np.zeros(len(faces),dtype=int); scene.face_local_ids=np.arange(len(faces),dtype=int)
scene.face_normals=normals; scene.records={0:Record()}
def triangle_details(g,t):
    return {'mesh_id':'synthetic','primitive_id':0,'source_vertex_indices':faces[t].tolist()}
scene.triangle_details=triangle_details
canonical=SimpleNamespace(canonical_to_source=np.eye(4))

def lm(name,p,group='body',side=None):
    return {'name':name,'group':group,'side':side,'canonical_position':list(p),'source_position':list(p),'confidence':.9,'geometry_id':0,'mesh_id':'synthetic','primitive_id':0,'triangle_id':0,'source_vertex_indices':[0,1,2],'barycentric':[.34,.33,.33],'surface_normal':[0,-1,0]}
landmarks=[
 lm('left_shoulder',[-.22,0,1.12]),lm('right_shoulder',[.22,0,1.12]),
 lm('left_elbow',[-.29,0,.92]),lm('right_elbow',[.29,0,.92]),
 lm('left_wrist',[-.29,0,.72]),lm('right_wrist',[.29,0,.72]),
 lm('left_hip',[-.10,0,.65]),lm('right_hip',[.10,0,.65]),
 lm('left_knee',[-.10,0,.36]),lm('right_knee',[.10,0,.36]),
 lm('left_ankle',[-.10,0,.07]),lm('right_ankle',[.10,0,.07]),
 lm('left_heel',[-.10,.04,.02]),lm('right_heel',[.10,.04,.02]),
 lm('left_foot_index',[-.10,-.12,.02]),lm('right_foot_index',[.10,-.12,.02]),
]
for side,x in [('left',-.29),('right',.29)]:
    landmarks += [lm('wrist',[x,0,.72],'hand',side),lm('middle_tip',[x,0,.60],'hand',side),lm('index_mcp',[x-.02,0,.68],'hand',side),lm('pinky_mcp',[x+.02,0,.68],'hand',side)]
face=SimpleNamespace(center_x=0.,center_y=0.,center_z=1.42,min_z=1.24)
measurements=calculate_body_measurements(scene,landmarks,[],face,180)
assert measurements['readiness']['measurements_ready']
assert measurements['values']['height']['value_cm'] > 170
anchors,warnings=build_garment_anchors(scene,canonical,landmarks,measurements)
assert len(anchors)>=18, len(anchors)
print('V0.8_FULL_SMOKE_OK',len(anchors),len(warnings))
