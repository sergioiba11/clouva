# Contrato de rig de prendas CLOUVA

Una variante solamente puede marcarse como `preFitted` cuando el GLB exportado cumple todo lo siguiente:

- Contiene al menos una `SkinnedMesh`.
- Todos los huesos usados por cada `SkinnedMesh` existen en el avatar oficial.
- Comparte al menos 8 huesos con el avatar oficial.
- No conserva un rig independiente como fuente de animación en el visor.
- Su caja final queda dentro de los límites esperados para su categoría.
- El visor no vuelve a escalar una pieza `preFitted`; la acepta o la bloquea.

El visor conecta las `SkinnedMesh` de la prenda al esqueleto cargado del avatar. Si falta un hueso, el GLB se bloquea y muestra un error visible. Esto evita aprobar o mostrar prendas gigantes, desplazadas o incompatibles y evita repetir generaciones de Meshy sin diagnóstico.
