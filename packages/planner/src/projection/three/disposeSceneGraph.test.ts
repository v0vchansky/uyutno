import {
  BoxGeometry,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Texture,
} from 'three';

import { disposeSceneGraph } from './disposeSceneGraph';

// Единственный Jest-тест слоя projection с импортом `three`: без WebGL (Node), только граф объектов и события `dispose`.

const spyDispose = (target: { addEventListener(type: 'dispose', listener: () => void): void }): jest.Mock => {
  const listener = jest.fn();
  target.addEventListener('dispose', listener);
  return listener;
};

describe('disposeSceneGraph — освобождение геометрий/материалов/текстур поддерева (ADR 0015 A7)', () => {
  it('освобождает геометрию, материал и его текстуры у каждого меша, включая вложенные группы', () => {
    const scene = new Scene();
    const map = new Texture();
    const geometry = new BoxGeometry();
    const material = new MeshStandardMaterial({ map });
    const group = new Group();
    group.add(new Mesh(geometry, material));
    scene.add(group);

    const geometryDisposed = spyDispose(geometry);
    const materialDisposed = spyDispose(material);
    const textureDisposed = spyDispose(map);

    disposeSceneGraph(scene);

    expect(geometryDisposed).toHaveBeenCalledTimes(1);
    expect(materialDisposed).toHaveBeenCalledTimes(1);
    expect(textureDisposed).toHaveBeenCalledTimes(1);
  });

  it('общий материал/текстура на нескольких мешах освобождаются один раз; мульти-материалы обходятся', () => {
    const scene = new Scene();
    const shared = new MeshBasicMaterial({ map: new Texture() });
    const second = new MeshBasicMaterial();
    scene.add(new Mesh(new BoxGeometry(), shared));
    scene.add(new Mesh(new BoxGeometry(), [shared, second]));

    const sharedDisposed = spyDispose(shared);
    const textureDisposed = spyDispose(shared.map!);
    const secondDisposed = spyDispose(second);

    disposeSceneGraph(scene);

    expect(sharedDisposed).toHaveBeenCalledTimes(1);
    expect(textureDisposed).toHaveBeenCalledTimes(1);
    expect(secondDisposed).toHaveBeenCalledTimes(1);
  });

  it('фон и окружение сцены-текстуры освобождаются; фон-цвет — нет ничего освобождать', () => {
    const scene = new Scene();
    const background = new Texture();
    const environment = new Texture();
    scene.background = background;
    scene.environment = environment;
    const backgroundDisposed = spyDispose(background);
    const environmentDisposed = spyDispose(environment);

    disposeSceneGraph(scene);

    expect(backgroundDisposed).toHaveBeenCalledTimes(1);
    expect(environmentDisposed).toHaveBeenCalledTimes(1);
  });

  it('освобождает не только Mesh: Line, Points, Sprite (геометрия + материал каждого)', () => {
    const scene = new Scene();
    const line = new Line(new BufferGeometry(), new LineBasicMaterial());
    const points = new Points(new BufferGeometry(), new PointsMaterial());
    const sprite = new Sprite(new SpriteMaterial());
    scene.add(line, points, sprite);
    const spies = [
      spyDispose(line.geometry),
      spyDispose(line.material),
      spyDispose(points.geometry),
      spyDispose(points.material),
      spyDispose(sprite.geometry),
      spyDispose(sprite.material),
    ];

    disposeSceneGraph(scene);

    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it('текстуры в uniforms ShaderMaterial освобождаются', () => {
    const scene = new Scene();
    const map = new Texture();
    const material = new ShaderMaterial({ uniforms: { map: { value: map }, scale: { value: 1 } } });
    scene.add(new Mesh(new BoxGeometry(), material));
    const textureDisposed = spyDispose(map);

    disposeSceneGraph(scene);

    expect(textureDisposed).toHaveBeenCalledTimes(1);
  });

  it('пустая сцена и поддерево без мешей — no-op без исключений', () => {
    expect(() => disposeSceneGraph(new Scene())).not.toThrow();
    expect(() => disposeSceneGraph(new Group())).not.toThrow();
  });
});
