# Casos de prueba del guard de rig

1. Avatar oficial riggeado + hoodie con los mismos huesos: debe mostrar `Rig validado · esqueleto compartido`.
2. Hoodie con armature de Meshy y nombres diferentes: debe ocultarse y mostrar el hueso faltante.
3. GLB sin `SkinnedMesh` marcado `preFitted`: debe bloquearse.
4. Prenda con menos de 8 huesos: debe bloquearse.
5. Prenda `preFitted` gigante o desplazada: debe bloquearse sin volver a escalarse.
6. Pieza experimental no `preFitted`: conserva el ajuste geométrico, pero se bloquea si continúa fuera de límites.
7. Durante el idle solamente se anima el rig del avatar; la ropa comparte esos huesos y acompaña el movimiento.
