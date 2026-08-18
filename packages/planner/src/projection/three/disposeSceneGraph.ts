import { BufferGeometry, Material, type Object3D, Scene, Texture } from 'three';

/**
 * Освобождает GPU-ресурсы поддерева сцены (ADR 0015 A7, `dispose()` проекции): геометрии, материалы и их
 * текстуры, фон/окружение сцены. Three сам этого не делает — без обхода `renderer.info.memory` растёт после
 * unmount. Один и тот же материал/текстура на нескольких мешах освобождается один раз (в three повторный
 * `dispose()` безопасен, но события `dispose` шлём по разу).
 */
export const disposeSceneGraph = (root: Object3D): void => {
  const materials = new Set<Material>();
  const textures = new Set<Texture>();

  root.traverse(object => {
    // Не только `Mesh`: `Line`/`LineSegments`/`Points`/`Sprite` тоже держат геометрию и материал.
    if (!hasRenderable(object)) return;
    object.geometry.dispose();
    for (const item of Array.isArray(object.material) ? object.material : [object.material]) materials.add(item);
  });

  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof Texture) textures.add(value);
    }
    // Текстуры кастомных шейдеров живут в `uniforms.*.value` (`ShaderMaterial`).
    if ('uniforms' in material && material.uniforms && typeof material.uniforms === 'object') {
      for (const uniform of Object.values(material.uniforms as Record<string, { value?: unknown }>)) {
        if (uniform?.value instanceof Texture) textures.add(uniform.value);
      }
    }
    material.dispose();
  }

  if (root instanceof Scene) {
    if (root.background instanceof Texture) textures.add(root.background);
    if (root.environment instanceof Texture) textures.add(root.environment);
  }

  for (const texture of textures) texture.dispose();
};

interface Renderable extends Object3D {
  geometry: BufferGeometry;
  material: Material | Material[];
}

const hasRenderable = (object: Object3D): object is Renderable =>
  'geometry' in object &&
  object.geometry instanceof BufferGeometry &&
  'material' in object &&
  (object.material instanceof Material || Array.isArray(object.material));
