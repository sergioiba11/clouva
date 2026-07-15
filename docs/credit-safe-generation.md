# Regla de generación segura

No regenerar una pieza en Meshy solamente porque se ve mal en el visor.

Primero revisar el mensaje de validación:

- `no contiene ninguna malla riggeada`: el Worker no produjo skinning.
- `faltan huesos`: el Worker exportó un armature incompatible.
- `solo comparte N huesos`: el rig está incompleto.
- `ajuste exportado está fuera del avatar`: la geometría o el fitting del Worker falló.

Una nueva generación con créditos solo corresponde cuando la geometría original es incorrecta. Los fallos de rig, pesos, exportación o fitting deben reintentarse desde Blender usando el mismo resultado de Meshy.
