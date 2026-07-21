# Diagnóstico del rig extendido

El rig anterior mezclaba medidas calculadas en espacio mundo con posiciones escritas directamente en espacio local del armature. Cuando el armature conservaba una transformación de importación, los segmentos nuevos de dedos podían multiplicar su longitud y aparecer como líneas que bajaban desde las manos. Además, los huesos de oreja se calculaban con una separación derivada del ancho total del avatar, lo que podía colocarlos fuera de la cabeza.

La corrección oficial debe construir cabeza y cola de cada hueso en espacio mundo, convertir ambos puntos al espacio local del armature y validar la geometría antes de aceptar el GLB.
