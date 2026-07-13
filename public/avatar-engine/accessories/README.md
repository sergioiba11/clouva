# CLOUVA Avatar Engine assets: accessories

Subir aquí archivos GLB/GLTF optimizados para el Avatar Engine. No se commitean binarios en esta iteración.

Requisitos para cada prenda/pieza:
- usar el mismo rig humanoide que el cuerpo base;
- declarar el mismo `compatibleSkeleton` / skeletonId: `clouva-humanoid-v1`;
- mantener escalas, pivotes y orientación compatibles con el cuerpo base;
- conservar nombres de huesos compatibles para poder reutilizar el skeleton del cuerpo base;
- exponer materiales nombrados de forma estable para aplicar colores desde `AvatarConfig.materialColors`.
