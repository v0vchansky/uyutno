# Three.js r134 → r185 — карта миграции для нашего редактора

> Часть каркаса. Наш редактор пишем на **Three.js r185**; референс-конкурент — на ~r134. Их код рендера / шейдеров / света под r185 **нежизнеспособен**, поэтому референс работает только на уровне архитектуры и алгоритмов, а весь код рендера пишем свежим. Этот документ фиксирует, что именно изменилось между r134 и r185 (≈51 релиз), чтобы писать корректный r185-код.
>
> **Источник:** официальный [Three.js Migration Guide (wiki)](https://github.com/mrdoob/three.js/wiki/Migration-Guide) + [release notes](https://github.com/mrdoob/three.js/releases). Формат — «что r185 ожидает», а не «как пропатчить r134».

## Три тектонических сдвига (усвоить до первой строки рендера)

1. **Color management включён по умолчанию** (r152) — всё sRGB-aware.
2. **Свет физически-корректный по умолчанию** (r155, `useLegacyLights` удалён) — легаси-интенсивности примерно в **π× темнее**.
3. **Библиотека только ESM**, аддоны в `three/addons/*` (UMD-сборка удалена r161).

---

## 1. Color management (r152) — CRITICAL

Главный источник багов «почему всё блёклое / тёмное / грязное». Основное — r152, доводка шейдер-чанков — r153.

| Что                           | r134 (старое)                            | r185 (новое)                                  | Действие                                                                       |
| ----------------------------- | ---------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------ |
| Дефолт ColorManagement        | `legacyMode` (opt-in)                    | `ColorManagement.enabled = true` по умолчанию | Ничего не отключаем; все `Color` считаются sRGB и конвертятся в linear         |
| Выход рендерера               | `renderer.outputEncoding = sRGBEncoding` | `renderer.outputColorSpace = SRGBColorSpace`  | Выставить явно                                                                 |
| Цвет-пространство текстуры    | `texture.encoding = sRGBEncoding`        | `texture.colorSpace = SRGBColorSpace`         | Color/albedo → `SRGBColorSpace`; data (normal/rough/metal/AO) → `NoColorSpace` |
| Переименование                | `sRGBEncoding`                           | `SRGBColorSpace`                              | Enum удалён                                                                    |
| Переименование                | `LinearEncoding`                         | `LinearSRGBColorSpace`                        | Enum удалён                                                                    |
| `gammaFactor`/`GammaEncoding` | было                                     | удалено (r136)                                | Не ссылаться                                                                   |
| RGB-форматы                   | `RGBFormat`                              | **есть в r185** (`1022`), удаляли в r137      | Всё равно авторить RGBA-текстуры, но не рассчитывать, что символа нет          |
| Шейдер-чанк                   | `encodings_fragment`                     | `colorspace_fragment` (r153)                  | Переименовать в кастом-шейдерах                                                |
| Шейдер-чанк                   | `output_fragment`                        | `opaque_fragment` (r153)                      | Переименовать                                                                  |

```js
// r134
renderer.outputEncoding = THREE.sRGBEncoding;
colorTexture.encoding = THREE.sRGBEncoding; // albedo
normalTexture.encoding = THREE.LinearEncoding; // data

// r185
import { SRGBColorSpace, NoColorSpace } from 'three';
renderer.outputColorSpace = SRGBColorSpace;
colorTexture.colorSpace = SRGBColorSpace; // albedo/diffuse/emissive
normalTexture.colorSpace = NoColorSpace; // normal/roughness/metalness/AO
```

**Важно:** `new THREE.Color('#8899aa')` при включённом ColorManagement трактуется как **sRGB** и конвертится в linear внутри. **Не пре-линеаризовать цвета руками** — двойная коррекция.

> Про `RGBFormat`: Migration Guide убирает его в r136→r137 («RGBFormat has been removed. Please use RGBAFormat instead»), но в r185 константа снова есть и экспортируется из `three` — проверено на `three@0.185.1`: `src/constants.js:754` (`export const RGBFormat = 1022;`), рантайм-импорт даёт `RGBFormat === 1022`, используется в `src/renderers/webgl/WebGLUtils.js:27`. Релиз, в котором её вернули, не установлен (_непроверено_). Практика прежняя — для наших текстур `RGBAFormat`, но обосновывать это «символа не существует» нельзя.

---

## 2. Свет / физические единицы (r155, r165) — CRITICAL

| Что               | r134                                       | r185                                        | Действие                                       |
| ----------------- | ------------------------------------------ | ------------------------------------------- | ---------------------------------------------- |
| Легаси-флаг света | `physicallyCorrectLights = false` (дефолт) | удалён; `useLegacyLights` тоже удалён       | Не задавать ни то, ни другое                   |
| Интенсивности     | произвольные                               | физически-корректные (candela/lux-подобные) | Легаси ~π× темнее; авторить заново под r185    |
| `Material.fog`    | на базовом `Material`                      | на конкретных материалах (**r139**)         | Ставить `fog` на Standard/Basic, не на базовом |

```js
// r185 — физически-корректный режим единственный
const dir = new THREE.DirectionalLight(0xffffff, Math.PI * 1.0); // ~3.14 чтобы совпасть со старым
const amb = new THREE.AmbientLight(0xffffff, Math.PI * 0.5);
// свойств physicallyCorrectLights / useLegacyLights не существует
```

> Про `Material.fog`: переезд — **r138→r139** по Migration Guide («The fog property has been moved from the abstract Material class to materials which actually support it»), не r155. Проверено на `three@0.185.1`: `new Material().fog === undefined`, `new MeshStandardMaterial().fog === true` (`src/materials/MeshStandardMaterial.js:402`, `src/materials/MeshBasicMaterial.js:231`).

Практически для планировщика: **авторить свет заново под r185**, а не механически ×π копировать значения конкурента (у них другая система единиц). Point/spot теперь подчиняются inverse-square + `decay` (дефолт 2). **r181:** непрямой specular и энергосбережение шершавых материалов изменились — PBR может выглядеть ярче; перетюнить roughness/env один раз на r185 и зафиксировать.

---

## 3. Renderer & render targets — IMPORTANT

| Что                                         | r134                           | r185                                                                     | Критичность                           |
| ------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------ | ------------------------------------- |
| `outputEncoding`                            | было                           | → `outputColorSpace` (r152)                                              | Critical (см. §1)                     |
| `physicallyCorrectLights`/`useLegacyLights` | —                              | удалены                                                                  | Critical (см. §2)                     |
| MSAA RT                                     | `WebGLMultisampleRenderTarget` | удалён — опция `{ samples: N }` на `WebGLRenderTarget`                   | Important                             |
| MRT                                         | `WebGLMultipleRenderTargets`   | удалён (r162) — свойство `count` на RT                                   | Important (G-buffer для SSAO/outline) |
| RT-тип пост-обработки                       | UnsignedByte                   | по умолчанию `HalfFloatType` (r153)                                      | Important                             |
| `copyTextureToTexture`                      | старая сигнатура               | новая: `(src, dst, srcRegion=null, dstPos=null, srcLevel=0, dstLevel=0)` | Minor                                 |
| Stencil                                     | по умолчанию `true`            | по умолчанию `false` (r163)                                              | Minor — запрашивать явно если нужен   |
| WebGL1                                      | поддерживался                  | удалён (r162/r163)                                                       | Important — мы WebGL2-only            |

Сигнатура `copyTextureToTexture` дана по r185 дословно — `three@0.185.1`, `src/renderers/WebGLRenderer.js:3270`: `( srcTexture, dstTexture, srcRegion = null, dstPosition = null, srcLevel = 0, dstLevel = 0 )`; в каком релизе единый `level` разошёлся на `srcLevel`/`dstLevel`, не установлено (_непроверено_).

**Тени:** `PCFSoftShadowMap` для WebGLRenderer **депрекейтнут в r182** — использовать `PCFShadowMap` (или VSM), проверить визуально. Настройка shadow-bias изменилась в r183.

---

## 4. Загрузчики — IMPORTANT

| Что          | r134                                  | r185                                                                      | Действие                       |
| ------------ | ------------------------------------- | ------------------------------------------------------------------------- | ------------------------------ |
| Путь аддонов | `three/examples/jsm/loaders/*`        | канонично `three/addons/loaders/*`                                        | Импортить из `three/addons/*`  |
| DRACOLoader  | `setDecoderPath` + `setDecoderConfig` | `setDecoderConfig` депрекейтнут (r185); WASM-only                         | Указывать путь к WASM-декодеру |
| KTX2Loader   | `detectSupport(renderer)`             | `detectSupport(renderer)` **после** init рендерера (r181)                 | Звать после init               |
| RGBELoader   | `RGBELoader`                          | переименован → `HDRLoader` (r180)                                         | Для HDR env-карт               |
| FileLoader   | XHR                                   | использует `fetch`; `load()` ничего не возвращает — через callback (r184) | Всегда callbacks/promises      |

```js
// r185 канонично
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const draco = new DRACOLoader().setDecoderPath('/draco/'); // WASM
const ktx2 = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer); // после init
const gltf = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
```

---

## 5. Кастомные шейдеры / пост-обработка — IMPORTANT (пишем outline/contour/SSAO)

| Что                    | r134                 | r185                                                                         | Действие                               |
| ---------------------- | -------------------- | ---------------------------------------------------------------------------- | -------------------------------------- |
| Enc-чанк               | `encodings_fragment` | `colorspace_fragment` (r153)                                                 | Переименовать в `#include`             |
| Output-чанк            | `output_fragment`    | `opaque_fragment` (r153)                                                     | Переименовать                          |
| GLSL3                  | opt-in               | `ShaderMaterial.glslVersion = GLSL3`; писать `out`, не `gl_FragColor`        | Ставить `glslVersion` на кастом-пассах |
| AO-пасс                | `SSAOPass`           | нужен предшествующий `RenderPass`; новый `GTAOPass` вместо `HBAOPass` (r160) | Предпочесть `GTAOPass`                 |
| Тонмаппинг в композере | инлайн               | только при рендере на экран (r154)                                           | Добавлять `OutputPass` в конце цепочки |

**Критичная ловушка (r154):** `renderer.toneMapping` применяется только при рендере **на экран**. В offscreen-цепочке EffectComposer тонмаппинг + перевод в sRGB делает **`OutputPass`** в конце:

```js
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// ... наши outline / GTAO пассы ...
composer.addPass(new OutputPass()); // тонмаппинг + sRGB
```

В кастом-фрагментшейдерах не хардкодить `LinearTosRGB()`, если пасс не финальный на экране — пусть `OutputPass` разруливает цвет.

---

## 6. Математика & геометрия — IMPORTANT (механическое, частое)

| Что                       | r134                                          | r185                                                                 |
| ------------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| Инверсия матрицы          | `Matrix4.getInverse(m)`                       | `m2.copy(m).invert()`                                                |
| Инверсия Matrix3          | `getInverse()`                                | `.invert()`                                                          |
| Инверсия кватерниона      | `Quaternion.inverse()`                        | `.invert()`                                                          |
| Слияние геометрий         | `BufferGeometryUtils.mergeBufferGeometries()` | `mergeGeometries()` (из `three/addons/utils/BufferGeometryUtils.js`) |
| Слияние атрибутов         | `mergeBufferAttributes()`                     | `mergeAttributes()`                                                  |
| `Geometry`/`Face3`        | удалены (`Face3` — r126, `Geometry` — r141)   | только `BufferGeometry`                                              |
| Нормализация кватернионов | лениво                                        | ожидаются нормализованными (r158)                                    |
| `THREE.Math`              | —                                             | `THREE.MathUtils`                                                    |

> Про `Geometry`/`Face3`: по Migration Guide `Face3` вынесен из core в r125→r126 («Face3 has been removed from core. It is now located in examples/jsm/deprecated/Geometry.js»), сам класс `Geometry` удалён в r140→r141 («The deprecated Geometry class has been removed»), а не оба разом в r125. В r185 обоих нет вовсе — проверено на `three@0.185.1`: рантайм-импорт даёт `Geometry === undefined` и `Face3 === undefined`, в `src/` нет ни одного вхождения.

---

## 7. Материалы & текстуры — IMPORTANT

| Что                            | r134          | r185                                           | Действие                                      |
| ------------------------------ | ------------- | ---------------------------------------------- | --------------------------------------------- |
| `Texture.encoding`             | свойство      | → `Texture.colorSpace` (r152)                  | См. §1                                        |
| Дефолты `MeshStandardMaterial` | (старые)      | `roughness 1 / metalness 0`                    | Задавать явно                                 |
| `envMapIntensity`              | влияло широко | только на собственный `envMap` (r163)          | Сила IBL — через `Scene.environmentIntensity` |
| Прозрачность                   | вручную       | `depthWrite` так и остался `true` по умолчанию | Явно управлять порядком (стекло/оверлеи)      |

> Про прозрачность: автоматики «`transparent = true` → `depthWrite = false`» в three нет и не было. Проверено на `three@0.185.1`: `src/materials/Material.js:123` (`this.transparent = false`) и `:230` (`this.depthWrite = true`), рантайм `new MeshStandardMaterial().depthWrite === true`. Изменение r113→r114 касалось только загрузчика: «GLTFLoader now sets depthWrite to false for transparent materials» — и в r185 это по-прежнему код GLTFLoader для `alphaMode: BLEND` (`examples/jsm/loaders/GLTFLoader.js:3623`). **Для нашей геометрии (стекло, оверлеи, подсветка) `depthWrite` выставляем сами** — по умолчанию он включён.

---

## 8. Модульная система / сборка — IMPORTANT (фундамент)

| Что          | r134                   | r185                        | Действие                                    |
| ------------ | ---------------------- | --------------------------- | ------------------------------------------- |
| UMD-сборка   | `build/three.js`       | удалена (r161) — только ESM | ESM + бандлер, никакого глобального `THREE` |
| Путь аддонов | `three/examples/jsm/*` | канонично `three/addons/*`  | Настроить import map / алиас бандлера       |
| Tree-shaking | ограничен              | ESM включает                | Импортить именованные символы               |
| TS-типы      | внешние `@types/three` | **в пакете типов нет**      | Ставить `@types/three` рядом с `three`      |

> Про типы — это была самая дорогая ошибка документа: **пакет `three` не поставляет TypeScript-деклараций.** Проверено на `three@0.185.1`: в `package.json` нет полей `types`/`typings`, во всём пакете **ноль** файлов `*.d.ts` (`find node_modules/.../three -name '*.d.ts' | wc -l` → `0`), `exports` отдаёт только `.js`. Типы живут отдельно в DefinitelyTyped и версионируются в такт: у нас `packages/planner/package.json` — `"three": "~0.185.1"` в `dependencies` и `"@types/three": "~0.185.4"` в `devDependencies`. Убрать `@types/three` = сломать `pnpm typecheck` на первом же `import { Scene } from 'three'` (см. `packages/planner/src/projection/three/ThreeProjection.ts:1`). JSDoc-типы в исходниках three существуют, но `.d.ts` из них в npm-пакет не кладут.

---

## 9. Controls — IMPORTANT (конкурент на глобальном `OrbitControls.js`)

| Что               | r134                          | r185                                                    | Действие              |
| ----------------- | ----------------------------- | ------------------------------------------------------- | --------------------- |
| Расположение      | глобальный `OrbitControls.js` | `three/addons/controls/OrbitControls.js` (ESM)          | Импортить как аддон   |
| База              | standalone                    | наследует `Controls` (r168), `connect()`/`disconnect()` | Единый lifecycle      |
| TransformControls | `scene.add(controls)`         | добавлять `scene.add(controls.getHelper())` (r169)      | Для гизмо move/rotate |
| DragControls      | `activate()`/`deactivate()`   | `connect()`/`disconnect()` (r168)                       | Новый lifecycle       |

Для top-down/orbit-камеры планировщика — `OrbitControls` (или `MapControls` для pan-центричного top-down) из `three/addons/controls/`.

---

## 10. WebGPU / TSL / Node materials — OPT-IN (только заметка)

r185 везёт зрелый **`WebGPURenderer`** (`three/webgpu`) и **TSL** (`three/tsl`). **Мы остаёмся на `WebGLRenderer` (`three`).** Не импортить из `three/webgpu`/`three/tsl`; пост-обработку берём классическими аддон-пассами (`three/addons/postprocessing/*`). TSL быстро меняется (много переименований r171–r185) — ещё причина не лезть, пока сознательно не мигрируем на WebGPU.

---

## Топ-10 «что укусит, если забыть»

Ранжировано по вероятности молча выдать неправильный результат:

1. **Color space на текстурах (r152).** Забыл `SRGBColorSpace` на albedo (или ошибочно повесил sRGB на normal/roughness) → блёклые/грязные материалы. Data-карты = `NoColorSpace`.
2. **Свет физически-корректный по умолчанию (r155).** `useLegacyLights` не существует. Копия r134-интенсивностей = сцена ~π× темнее. Авторить заново.
3. **`OutputPass` в конце EffectComposer (r154).** Иначе offscreen-цепочка тёмная/линейная.
4. **Не double-correct цвета.** `new Color('#..')` уже sRGB; пре-линеаризация руками = неправильно.
5. **`outputColorSpace`, не `outputEncoding` (r152).** Старое свойство удалено.
6. **ESM-only + `three/addons/*` (r161).** Никакого глобального `THREE`; настроить бандлер/import map.
7. **Шейдер-чанки (r153):** `encodings_fragment`→`colorspace_fragment`, `output_fragment`→`opaque_fragment`.
8. **Мат-переименования:** `getInverse()`→`.invert()`, `Quaternion.inverse()`→`.invert()`, `mergeBufferGeometries()`→`mergeGeometries()`.
9. **MRT/MSAA-классы удалены:** `WebGLMultipleRenderTargets`(r162)→`count`; `WebGLMultisampleRenderTarget`→опция `{ samples }`.
10. **Дефолты `MeshStandardMaterial`** (`roughness 1/metalness 0`) и `Scene.environmentIntensity` (r163) для силы IBL. Задавать явно.

---

## Оговорки по точности

- Оба пути — `three/examples/jsm/*` и `three/addons/*` — резолвятся в r185 (`three@0.185.1`, `package.json` → `exports`: `"./examples/jsm/*"`, `"./addons/*"`, `"./addons"`), канонично `three/addons`. Релиз, в котором алиас появился, не установлен (_непроверено_).
- `useLegacyLights`: дефолт `false` и депрекейт — **r154→r155** (Migration Guide). В r185 свойства нет: `grep` по `src/` и `build/three.module.js` на `useLegacyLights`/`physicallyCorrectLights` даёт ноль вхождений (`three@0.185.1`). Релиз окончательного удаления не установлен (_непроверено_).
- `PCFSoftShadowMap` депрекейтнут для WebGLRenderer в r182 — для нас предпочесть `PCFShadowMap` (или VSM), проверить мягкость теней визуально. Подтверждено в r185: `src/renderers/webgl/WebGLShadowMap.js:99–101` — при `type === PCFSoftShadowMap` рендерер пишет `warn('WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead.')` и молча подменяет тип.

**Как проверялось (2026-08-21):** установленный `three@0.185.1` (`node_modules/.pnpm/three@0.185.1/node_modules/three`, `REVISION === '185'`) — исходники и рантайм-импорт; официальный [Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide) — для номеров релизов. Пункты, помеченные _непроверено_, ни одним из двух источников не закрываются — не выдумывать их при написании ADR G.
