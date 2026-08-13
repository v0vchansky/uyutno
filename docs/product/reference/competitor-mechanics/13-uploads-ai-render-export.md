# Загрузки / AI-модель / фотореалистичный рендер / 360 / экспорт (competitor mechanics)

> **Что это.** Реверс-инжиниринг «выходных», монетизируемых функций редактора-конкурента [roomtodo.com](https://roomtodo.com): пользовательские загрузки (3D-модель GLB, материал/ковёр/постер), генерация 3D-модели из фото (AI image→3D), фотореалистичный рендер (2K/4K/360 как серверная задача с поллингом), 360-туры, редактор логотипов/декалей, экспорт (2D PDF на клиенте vs 3D-форматы на сервере) и покупка кредитов. Вычитано из не минифицированного `plannercore.js` (ядро), `user.js` (`R2D.UserCore.*` — слой API/сохранения) и React-UI под `src/react_src/planner_front/src/js/react/jsx/components/...`. Номера строк ссылаются на эти файлы.
>
> **Статус источника.** Это **референс чужой механики**, а не наши продуктовые решения. Именно здесь конкурент зарабатывает: всё «редактирование» бесплатно, платно только «извлечение» результата (фотореал-картинка, файл экспорта, view-only-шеринг). Код не копируем — описываем поведение своими словами со ссылками как доказательство, что это из живого кода. Из этого выведем собственные feature-спеки в `docs/product/features/`.
>
> **Важно про доверие.** В конце — блок «Confidence & gaps»: что вычитано из кода дословно, что додумано (inferred), чего не нашли (в частности литералы URL эндпоинтов server-injected в `R2D.URL.*`, платёжный шлюз и рендер-движок — чёрные ящики).

---

## Обзор — три оси монетизации

roomtodo разделяет **«редактирование» (бесплатно)** и **«выходы» (платно)**. Оси:

1. **План** (`free` / `basic` / `pro`) — гейтит _доступ к фичам_ (видимость пользовательских загрузок, 3D-экспорт, view-only-шеринг, сохранение своих моделей).
2. **Кредиты** (целочисленный баланс, `user.js:16,25,35`) — тратятся за **фотореал-рендер** и за **AI image→3D**. Покупаются à-la-carte через встроенный платёжный iframe.
3. **Всё видимое в редакторе — это WebGL-превью**; _продаваемые_ артефакты (фотореал-рендер, 360-тур, hi-poly-файлы экспорта) собираются **на сервере** из выгруженного снапшота сцены.

Контракт клиента для любого платного выхода один и тот же, в три шага: **(1)** сериализовать сцену в zip, **(2)** запостить её + метаданные камеры/кадра на task-эндпоинт, получить `taskId`/`renderId`, **(3)** опрашивать статус-эндпоинт до `stored`/`success`, затем открыть/скачать URL результата. Тяжёлая работа (трассировка лучей, конвертация форматов, AI-генерация меша) **не в клиенте вообще**.

Карта фич/цен (из React-UI):

| Выход                                      | Тип               | Стоимость                         | Гейт           | Клиентский метод                              |
| ------------------------------------------ | ----------------- | --------------------------------- | -------------- | --------------------------------------------- |
| Скриншот                                   | PNG вьюпорта      | **бесплатно**                     | нет            | `R2D.scene.makeRenderScreenShot()` (локально) |
| Фотореал 2K (1920×1080)                    | серверный рендер  | **1 кредит**                      | кредиты        | `user.makeRender({type:3})`                   |
| Фотореал 4K (3840×2160)                    | серверный рендер  | **2 кредита**                     | кредиты        | `user.makeRender({type:4})`                   |
| 360° панорама-рендер                       | серверный рендер  | **4 кредита**                     | кредиты        | `user.makeRender({type:5})`                   |
| 360° виртуальный тур                       | сшитый тур        | tour-builder (iframe)             | —              | `/tours/add`, `user.uTours360_*`              |
| AI image→3D модель                         | AI-меш            | **1 кредит**                      | кредиты        | `R2D.modelAIUploader.createNewModel()`        |
| Своя 3D-модель (GLB)                       | загрузка          | загрузка free, **сохранение PRO** | план           | `R2D.modelUploader.*`                         |
| Свой материал/ковёр/постер                 | загрузка          | free (видимость гейтит план)      | план           | `R2D.customUploader.upload*()`                |
| 2D PDF-план                                | экспорт (клиент)  | free                              | basic (мягкий) | `R2D.pdfCreator.createView2D` (локально)      |
| 3D-экспорт (IFC/FBX/GLB/OBJ/DAE/DXF/BLEND) | серверный экспорт | —                                 | **PRO**        | `user.makeExport({type:1,format})`            |
| Логотип/декаль на поверхности              | клиентский декаль | free                              | —              | `R2D.LogoEditor`                              |
| Ссылка/эмбед                               | шеринг            | free; **view-only = PRO**         | план           | `planner.scene.setOnlyViewParam()`            |

`rendersPrices = { '2k':1, '4k':2, '360':4 }` — `renderMake/main/Main.jsx:424-428`.

---

## Пользовательские загрузки

### Своя 3D-модель — `R2D.ModelUploader` (plannercore.js:19173-21255)

- **Всё нормализуется в GLB на клиенте до загрузки.** `save()` (plannercore.js:20306+) собирает `FormData`: `source=scene.glb` (blob от Three.js `GLTFExporter`), `preview=prev.png`, опционально `svg`/`svg_outline` (2D-иконка плана), опционально `metaZip` — постит на `URL_UPLOAD_FILE`, затем вторым вызовом регистрирует сущность на `URL_UPLOAD_ENTITY` (plannercore.js:20328-20385; 24495-24496). Авторизация — заголовки `x-token` / `x-lang`, `withCredentials`.
- Два пути приёма: **загрузка директории** с рассыпанным glTF-набором (`.gltf`-главный + `.bin` + картинки, plannercore.js:19339-19430) и **`.glb`-файл** (`input.accept='.glb'`, plannercore.js ~20492, 20796 `openUserGlb`). Есть и `.zip`-путь (`input.accept='.zip'`).
- **Валидация (React, `UploadCustomModelPopup.jsx`):** только `.glb`, **≤ 60 МБ**, **≤ 60 000 треугольников** (`getTotalTriangles`, plannercore.js:20177), **≤ 50 частей/мешей** (`getPartsHashes`, plannercore.js:20187).
- **Пер-парт назначение материала** (панель uploadModel): каждый меш-«парт» (по хэшу) получает материал либо из встроенной GLB-текстуры («from model»), либо из каталожного банка (`setPartMatId`, `setAllPartsSourcesAsBank`), с UV-трансформами (поворот CW/CCW, флип X/Y). У модели есть мини-кубик-навигатор орбиты (`sceneCube`).
- **Метаданные:** width/height/depth/elevation (см), теги, мульти-язычные названия, категории, `public`, `isOriginalModel` — сохраняются в сущности (plannercore.js:19196-19204, 20306+).
- **Гейт:** загрузка/превью открыты, но **Save только PRO** (замок + `UPGRADE_YOUR_PLAN_TEXT`, uploadModel `Main.jsx:535-546`).

### Свои материалы / ковры / постеры — `R2D.CustomUploader` (plannercore.js:249-598)

- Три метода `uploadMaterial` / `uploadCarpet` / `uploadPoster`, все: строят 240px-превью-миниатюру, прогоняют картинку через `*Creator` (`MaterialCreator`/`CarpetCreator`/`PosterCreator`), чтобы запечь текстурный **пакет** (blob), затем `POST URL_UPLOAD_PRIVATE` с base64 `source`+`preview`, размерами и `type_id`. Type-id: настенный материал `1`, напольный `5`, постер `3`, ковёр `4`, материал модели `7`, color-picker `6` (plannercore.js:594-599).
- Особенность ковра: хранится как тонкий cover — `height=1`, `depth=<реальная высота>` (plannercore.js:444-455).
- **React (`UploadCustomMaterialPopup.jsx`):** JPG/JPEG/PNG/WEBP/GIF/SVG, **≤ 20 МБ**; пользователь задаёт реальный размер в см (по умолчанию 60 см; ковёр по умолчанию 120 см); опционально `material_bank_category_id` (в банк) vs `category_id`. Живое 3D-превью через `R2D.MaterialUploaderPreview3d` (plannercore.js:21353+) — самодостаточная Three.js-сцена с референс-стеной (400×250), полом, силуэтом человека 180 см для масштаба и заглушками постера/ковра.

> Детали бинарного формата пакета `ROOMTODO` (материал/модель/постер/ковёр), парсер `R2D.ProductPackageParser` и писатели `R2D.ProductPackageCreator.*` — в секции [`12-catalog-assets.md`](12-catalog-assets.md). Здесь — только «откуда берётся пакет» и как он уходит на сервер.

---

## AI image→3D — `R2D.ModelAIUploader` (plannercore.js:21256-21337)

«Сгенерируй 3D-модель мебели из фотографии».

- `createNewModel(formData)` → `POST URL_AI_CREATE` (`credentials:'include', mode:'cors'`) → `{status:'ok', data:{taskId}}` (plannercore.js:21262-21298). `taskId` кладётся в watch-список `loadingModels[]`.
- `checkStatus(id)` → `GET URL_AI_GET` (`{id}` подставляется в шаблон) → `{status, data:{task:{progress}, entityId, status}}` (plannercore.js:21300-21330). Готово, когда есть `entityId` (`data.entityId && status=='ok' && dataStatus=='success'`).
- **React (`UploadCustomModelAiPopup.jsx`):** вход **JPEG/PNG ≤ 20 МБ**, **1 кредит**, обязательный чекбокс с условиями; поллинг каждые **500 мс** с **5-минутным таймаутом**; прогресс-бар `progress*3`, обрезается до 100. На успехе панель uploadModel переключается в `{type:'change', id: entityId}`, и AI-меш попадает в **тот же пер-парт редактор материалов**, что и обычная загрузка. Если `credits<1` → попап `buyCredits`.
- Серверный эндпоинт **`/image_with_model_ai/`**: `POST` multipart (image + categoryId) → `{taskId}`; `GET .../{id}` → progress/entity.

**Продуктовое решение:** AI-выход **редактируемый, а не чёрный ящик** — генерированный меш падает в тот же UI назначения материалов по частям, что и ручная загрузка. Хороший инстинкт: пользователь дорабатывает результат, а не принимает как есть.

---

## Фотореалистичный рендер (2K/4K/360)

**Клиент — НЕ рендерер.** In-editor 3D — это Three.js-превью. `R2D.RenderUpdater` (plannercore.js:10202-10260) — всего лишь `requestAnimationFrame`-троттл (по умолчанию 5 кадров), который перерисовывает _превью_-WebGL-канвас, пока правка устаканивается; к серверному рендеру он отношения не имеет. `R2D.RenderFrame` (plannercore.js:10624-10711) — чисто визуальный **16:9-кроп-оверлей** (четыре DOM-«леттербокс»-полосы) поверх вьюпорта, чтобы пользователь скадрировал снимок; `getData()` возвращает `{screenWidth, screenHeight, frameWidth, frameHeight, ratioWidth:16, ratioHeight:9}`.

### Сабмит — `R2D.UserCore.UserRenders.makeRender(renderObj)` (user.js:1420-1533)

1. `fillAnsZipProjectData()` (user.js:1459-1500) строит снапшот сцены:
   - `data = R2D.controller.scene.getSceneState(true)` — полное состояние сцены.
   - `data.scene.products = products.filter(i => i.visible)` — только видимые продукты (frustum-culling **закомментирован** — user.js:1465-1470, намеренный откат).
   - Параметрическим продуктам масштаб сбрасывается в 1 (`sx=sy=sz=1`, user.js:1472-1478).
   - `data.scene.modelsZipSrc = await productHelper.exportZipSendModels()` — заливает референсные кастомные модели zip'ом и хранит URL (чтобы рендер-сервер дотянул геометрию, которую сам не хостит).
   - `covers` мапятся в `cv: cvisible?1:0` (user.js:1483-1486).
   - `data.preview = <скриншот вьюпорта base64>` (low-res-превью для миниатюры в истории).
   - Всё → JSZip (`content.json`, DEFLATE level 9) → base64 data-URL-строка.
2. `POST` JSON на `R2D.URL.URL_RENDER_NEW` (user.js:1447-1457, `Content-Type: application/json`) с телом:
   `{renderType(3|4|5), renderView(interior|exterior|top), renderOrientation, renderData:{environment:null}, projectData(<base64 zip>), frameData:{screenWidth,screenHeight,frameWidth,frameHeight}, cameraData}`.
   - `cameraData` = `R2D.Viewers.getCameraData()`, `renderOrientation` = `R2D.Viewers.getRenderScreenType()`.
   - `renderView` (user.js:1513): walk-viewer → `interior`; иначе `topView` → `top`; иначе `exterior`.
3. Сервер отвечает `{status:'ok', data:{renderId}}` → резолвит `renderId`. Ошибка `error:'not_enough_credits'` → `TEXT_RENDERS_NOT_CREDITS` (user.js:1426-1428). **Кредиты списываются на сервере в момент сабмита**, не на клиенте — клиент лишь заново тянет профиль, чтобы показать новый баланс (`Main.jsx:485-496`).

**Кредитный гейт на клиенте — только пред-проверка** (`Main.jsx:467-472`): блокирует и открывает `buyCredits`, если `credits < cost`. Авторитетное списание — на сервере (возвращает `not_enough_credits`).

### Поллинг / доставка

**Нет websocket/push** — это интервальный поллинг:

- `RendersAnd360Popup.jsx` ставит интервал **15 000 мс**, зовёт `user.loadRenders(20, offset)` и следит за списком `planner.renders.inProgressIds[]`. **In-progress статусы (6, каноничный список — `RendersAnd360Popup.jsx:738`):** `waiting`, `created`, `rendering`, `taken`, `start`, `finished`. **Терминальные (2):** `stored` (успех) / `error` (упало) — проверка `status=='stored'||status=='error'` (`RendersAnd360Popup.jsx:560/798`, `renderMake/main/Main.jsx:517`). Плюс служебный `deleted` (не рендерится). **⚠️ `finished` семантически звучит терминально, но в коде это in-progress — поллинг на нём НЕ останавливается** (терминальны только `stored`/`error`).
- На `stored`/`error` диспатчит `planner.apiScene.RENDERS_UPDATE` и выкидывает id из `inProgressIds`; интервал чистится, когда список пуст.
- Попап `RenderDone` («RENDER_WELL_DONE / RENDER_IN_PROGRESS») — **fire-and-forget-подтверждение** сразу после сабмита; он _не_ ждёт картинку, результат появляется позже в списке рендеров.

### История / очередь рендеров — `R2D.UserCore.UserRenders` (user.js:1293-1533)

- Список: `GET URL_RENDER_ALL&limit=&offset=` → `{status:'ok', data:{items:[...]}}` (user.js:1298-1341).
- Открыть: `GET URL_RENDER_GET` (`{id}` в шаблоне) → `{data:{url}}`; открывается через `window.open(DOMAIN+url)` (user.js:1359-1389; `RendersAnd360Popup.jsx:483-485`). Скачивание = fetch картинки → canvas → save `render_ID_{id}`.
- Удалить: `DELETE URL_RENDER_DELETE` (user.js:1343-1357).
- Перезапуск упавшего: `PUT URL_RENDER_RELOAD`; может вернуть `render can't be restarted` → `RENDER_ERROR_CANT_RELOAD` (user.js:1391-1414).

**Выведенный контракт `/renders_2k_4k/`** (имя эндпоинта server-injected в `R2D.URL.*`): `POST /renders_2k_4k/ {renderType, renderView, renderOrientation, renderData, projectData(zip), frameData, cameraData}` → `{status, data:{renderId}}`; `GET .../{id}` → статус+URL; `PUT .../{id}` reload; `DELETE .../{id}`. `renderType 3=2K, 4=4K, 5=360`. Поля item для UI: `{id, renderId, type, status, preview, created, actions.open.link, error}`.

---

## 360-панорама и виртуальные туры

Под ярлыком «360» — две разные вещи:

- **360-панорама-рендер** (`renderType:5`, 4 кредита) — тот же `makeRender`-пайплайн, выдаёт equirect-панораму; доступен только для interior/exterior, отключён для topView (`Main.jsx`). Результат открывается через `window.open(DOMAIN + actions.open.link)` (`RendersAnd360Popup.jsx:481`) — то есть отдаётся как хостируемая страница-вьюер, а не голая картинка.
- **Виртуальный тур** — `R2D.UserCore.UserTours360` (user.js:1621-1741) — многоузловой проходимый тур, собираемый в **отдельном полноэкранном iframe-инструменте** (`Tour360Create.jsx`, грузит `DOMAIN + editUrl` или `/tours/add?lang=`). Билдер общается с React-оболочкой через **postMessage**-экшены `tour_360_cancel` / `tour_360_save`; на сохранении оболочка диспатчит `planner.apiScene.UPDATE_TOURS`.
  - Список: `POST URL_360_TOURS_GET {t:token, a:'get_tours_list', lang}` → `{status, data:[tours]}` (user.js:1626-1682). Item тура: `{h(id), name, preview, edit, view, createdAt, updatedAt, delete, status}`.
  - Удалить: `DELETE /api2{tour.delete}` (user.js:1684-1740).
  - Шеринг: открывает `SharePopup` с `view`-URL тура (публичная ссылка + iframe-эмбед).

Хранение: туры — серверные сущности по хэшу `h`; клиент держит только URL. Шеринг = публичный `view`-URL + встраиваемый `<iframe>`.

`R2D.pageFromZip` / `pageFromZipUrl` (plannercore.js:24377-24560) — **офлайн-page-бандлер**: грузит zip, `.html/.htm/.js/.css` держит как строки, всё прочее как blob-URL, и переписывает ссылки, собирая самодостаточную страницу. Так рендерится скачанный бандл тура/сцены standalone.

---

## Редактор логотипов / декалей — `R2D.LogoEditor` (plannercore.js:18323-18930)

Клиентский инструмент **размещения декали/логотипа**: наносит картинку пользователя на поверхность продукта (меш с `userData.width/height`), компонуя её на пер-меш-канвас, который становится прозрачным оверлеем материала. Параметры `{logoIndex, kx, ky (0..1 UV-центр), logoWidth, logoHeight (см), ratioWidthToHeight}` (plannercore.js:18337-18346). `pixPerCm=10`, мин/макс размер логотипа 2/1000 см. Загрузка = `image/*` → `sendLogoToServer` постит `logoImg` на `URL_UPLOAD_FILE`, сервер возвращает сохранённое имя файла, которое пишется в сцену как `logoSrcList` / `logoFileNamesList` (plannercore.js:18424-18447; save/load сцены на 15584, 15658, 15764). Редактирование входит в сфокусированное состояние камеры (`isLogoEditing`) с drag-to-move по поверхности (`sensitiveMove`). Это «нанеси бренд/фото на продукт» (кастомные постеры, брендированная мебель).

---

## Экспорт — `R2D.UserCore.UserExport` (user.js:236-388)

Тот же zip-снапшот-контракт, что и у рендера. `makeExport(renderObj)`:

- `fillAnsZipProjectData()` → `getSceneState(true)` + preview → JSZip → base64.
- `POST URL_EXPORT_SCENE` с `{format, exportType, renderData:{environment}, projectData, frameData, cameraData}` → `{status:'ok', data:{exportId}}` (user.js:294-321).
- **Гейт — по ТАРИФУ, не кредитами.** 3D-форматы → строго `pro`, 2D → `basic` (`ExportPopup.jsx:585`, `Main.jsx:636-666`). Кредиты — механика **рендера**, не экспорта. Серверная ветка `not_enough_credits` в `makeExport` (user.js:246) — клон-остаток от рендера (тот же текст `TEXT_RENDERS_NOT_CREDITS`); export-специфичного кредитного UI нет.

**Поллинг статуса экспорта — два раздельных пути:**

- **Не-IFC (серверный экспорт):** `setInterval` **500 мс** (`Export3DProjectPopup.jsx:624`), опрашивает `GET /api2/exporter/status/{taskId}` (user.js:326-387) → `{status, data:{status, file}}`. Успех = `response.status=='ok'` + наличие `file`; ошибка = `response.data.status==-20` (коды из **разных полей** ответа). (Для контраста рендер поллит **15 000 мс**.)
- **IFC — БЕЗ поллинга:** генерится **в браузере** (`R2D.controller.exportToIFC()`), готовность приходит **событием** `ifcStatus` (код `'20'`, `Export3DProjectPopup.jsx:561/574`).

**Форматы (React `exportPopup`):**

- **2D (`type:0`, `format:'pdf'`)** — PDF-план, генерируется **на клиенте** через `R2D.pdfCreator.createView2D` (`getDataurlstring` / `download`), _не_ на сервере. Форматы бумаги A3/A4/A5/B4/B5/Letter; масштабы 1:10…1:200 (+imperial, +fit); тогглы: показать масштаб / площадь комнаты / имя комнаты / размеры / текстуру ландшафта. **Гейт «мягкий»:** free-юзеру показывают плашку «доступно на basic/pro» + замок (`ExportPopup.jsx:585-601`), но поток **НЕ блокируется** — `onContinue` план не проверяет, download синхронный без await. То есть 2D → basic-или-pro визуально, но технически проходит.

  - **`R2D.PDFCreator` — два режима источника картинки в PDF.** (а) `view2d` — берёт **растровый скрин 2D-вьюпорта** (тот же view-2D-канвас, что видит пользователь) и вставляет как изображение. (б) `constr` — **векторная перерисовка контуров плана «с нуля»** (не скрин, а повторный рендер линий: контуры стен, размеры, площадь, имя, модели на стенах) — чётче и масштабонезависимо. То есть `createView2D` — не единственный путь; `constr`-ветка даёт вектор, `view2d` — растр.
  - **Шрифт вшит base64.** `Roboto` (~224 КБ) закодирован base64 **прямо в бандл** PDF-генератора (нет внешней загрузки шрифта → PDF самодостаточен, но раздувает JS). _Анти-паттерн для нас: подгружать/сабсетить шрифт, а не хардкодить 224 КБ в бандл._
  - **PDF = ПЛАН, а не смета.** Содержимое PDF — только **чертёж** комнаты: контуры, размеры стен, площадь, масштаб, имя, модели на стенах (+ опц. текстура пола). **Списка товаров / спецификации / цен / сметы в PDF НЕТ** — экспорт это документ-чертёж, не коммерческое предложение. (Продуктовая заметка: у нас смета/BOM — отдельный выход, не часть чертёжного PDF.)
  - **Матрица экспортного UI (кратко):** 6 форматов бумаги (A4 / A5 / A3 / Letter / B5 / B4) × **portrait/landscape**; **9 масштабов + авто-fit** (подгон под лист); тумблеры содержимого (масштаб / имя / площадь / размеры / текстура пола); **живой preview** результата до скачивания.

- **3D (`type:1`)** — серверный экспорт через `URL_EXPORT_SCENE`, форматы **IFC, BLEND, FBX, GLB, DXF, OBJ, DAE**; у IFC особый клиентский путь (в браузере, событие `ifcStatus`). **Строго PRO-гейт.** Прогресс опрашивается (500 мс) до URL скачивания; IFC — по событию.

`/switch_image/` — это лента ассетов сравнения **«скриншот vs 2K» (before/after)** (глобальный массив `switch_image` из `{img_1: screenshot, img_2: 2k_render}`), питающая маркетинговые слайдеры `RenderExample`. Это _продажный/upsell_-эндпоинт, **не** часть сабмита рендера. Соседние массивы: `renders_2k_4k` (2K-vs-4K-сравнение) и `images_360` (примеры iframe-туров).

---

## Покупка кредитов — `BuyCredits.jsx`

- Пакеты 5/10/20/50/100 (+ contact sales). `POST /api/credits/packets` → `{numOfCredits, pricePerCredit, priceTotal}`.
- Покупка = грузит платёжную форму в **iframe**: `/api/credits/get_form?credits=&lang=&token=`.
- После оплаты React **поллит** (2 с) изменение баланса кредитов и слушает postMessage `action:'credits_buy_finish'`; GTM-события `order_credit`/`buy_credit`/`cancel_order_credit`.

---

## Модель данных и форматы (точно)

**Снапшот сцены (рендер и экспорт)** — zip с `content.json`:

```
content.json = R2D.controller.scene.getSceneState(true) плюс:
  .preview             base64 PNG (снимок вьюпорта, миниатюра)
  .scene.products[]    только видимые; параметрическим scale сброшен в 1
  .scene.modelsZipSrc  URL отдельно залитого zip'а геометрии кастомных моделей
  .construction.covers[].cv  1|0 (из cvisible)
```

Zip: JSZip, DEFLATE level 9, отдаётся как **base64 data-URL-строка** в JSON-поле `projectData`.

**makeRender POST body:** `{renderType(3|4|5), renderView(interior|exterior|top), renderOrientation, renderData:{environment:null}, projectData, frameData, cameraData}`.
**makeExport POST body:** `{format, exportType(0|1), renderData:{environment}, projectData, frameData, cameraData}`.

**Render item (список):** `{id, renderId, type, status, preview, created, actions:{open:{link}}, error}`. `status ∈ {waiting, created, rendering, taken, start, finished` (все in-progress) `| stored` (успех) `| error` (упало) `| deleted` (служебный)`}`. Терминальны только `stored`/`error`; `finished`, несмотря на имя, in-progress.

**AI-task:** create → `{status:'ok', data:{taskId}}`; status → `{status, data:{task:{progress}, entityId, status}}` (готово, когда `entityId` задан).

**Custom upload (`URL_UPLOAD_PRIVATE`, form-encoded):** `{type_id, source(base64), preview(base64), width, height[, depth][, category_id | material_bank_category_id]}`. Загрузка модели — **multipart FormData** на `URL_UPLOAD_FILE` (`source=scene.glb, preview=prev.png, svg, svg_outline, metaZip`) + `URL_UPLOAD_ENTITY`.

**Logo-параметры (в сцене):** `{logoIndex, kx, ky, logoWidth, logoHeight, ratioWidthToHeight}`; сцена несёт `logoSrcList[]` / `logoFileNamesList{}` (серверные имена файлов).

**Лимиты:** кастомная модель ≤60 МБ / ≤60 000 тр. / ≤50 частей; материал/ковёр/постер-картинка ≤20 МБ (JPG/PNG/WEBP/GIF/SVG); AI-картинка ≤20 МБ (только JPEG/PNG).

---

## Продуктовые решения (что стоит перенять)

- **Чистый раскол free-vs-paid.** Редактор полностью юзабелен бесплатно; платишь только за _извлечение_ ценности (фотореал-картинка, файл экспорта, view-only-шеринг). Низкий порог вовлечения, ясный paywall в момент воспринятой ценности. **Перенимаем.**
- **Две валюты, два интента.** Кредиты = расходники за артефакт для compute-тяжёлых выходов (рендер, AI). План = постоянный анлок способностей (загрузки, 3D-экспорт, шеринг). Так монетизируются и разовые power-юзеры, и повторяющиеся про.
- **Разрешение рендера как ценовая лестница** (2K=1 / 4K=2 / 360=4, AI=1). Скриншот бесплатен, чтобы посеять привычку; слайдеры сравнения «before/after» (`switch_image`) — чистый upsell, конвертирующий screenshot-юзеров в платные рендеры.
- **Рендер как асинхронная задача с дружелюбным «мы пингнём»** (`RenderDone`) вместо блокировки. Пользователь продолжает работать, результаты приземляются в персистентную историю с retry.
- **AI image→3D переиспользует редактор загрузки модели** — генерированный меш падает в тот же пер-парт UI материалов, то есть AI-выход _редактируемый_, а не чёрный ящик.
- **Клиент нормализует все загрузки модели в GLB** — один канонический формат на сервере, правка текстур/UV до сохранения. Силуэт человека для масштаба в превью материала — приятная деталь юзабилити.
- **Шеринг/эмбед — first-class** (публичная ссылка + iframe), с view-only-локом за PRO, чтобы защитить «редактируемый оригинал».

## Анти-паттерны / что НЕ копируем

1. **Интервальный поллинг везде — 15 с / 500 мс / 2 с.** Ни websocket, ни SSE. Расточительно и лагает (рендер может простоять «finished» до 15 с, пока UI заметит). **Делаем push/подписку (SSE или WS) или хотя бы экспоненциальный backoff.**
2. **Вся сцена сериализуется и base64'ится в тело JSON.** Base64 раздувает zip на ~33% и прогоняет весь проект через память строкой; крупные сцены захлебнутся. **Заливаем zip бинарём (multipart/presigned-PUT), в payload задачи шлём только ссылку.** (Они уже так делают для моделей через `modelsZipSrc` — обобщить.)
3. **Кредит-чек — клиентский пред-гейт, авторитет на сервере** — ок, но клиент слепо доверяет форме полей `getSceneState` и дублирует целиком замыкания `makeRender`/`makeExport` (в user.js две почти идентичные копии). **Один сериализатор, серверная авторитетная цена, типизированная схема задачи.**
4. **Frustum-culling продуктов перед рендером закомментирован** (user.js:1465-1470) — так каждый видимый продукт уезжает, даже вне кадра, раздувая payload. **Куллим по frustum рендера.**
5. **`RenderFrame` хардкодит 16:9**; portrait/прочие соотношения прикручены через `renderOrientation`. **Делаем aspect ratio first-class-параметром задачи рендера.**
6. **Смешанный транспорт и обработка ошибок.** `XHRLoader` для одних вызовов, `fetch` для AI/логотипа; конвенции статусов пляшут (`'ok'` vs `'success'`, `error`-строка vs объект). Каждый хендлер заново реализует parse+status-чек. **Один типизированный HTTP-клиент + один конверт job/result.**
7. **Раздвоение (даже растроение) экспорта:** 2D PDF генерится на клиенте (`R2D.pdfCreator`), не-IFC 3D — на сервере с поллингом 500 мс, IFC — в браузере по событию `ifcStatus`; три разных кодопути, три семантики прогресса, коды статуса из разных полей ответа. **Унифицируем за одной export-job-абстракцией где возможно.**
8. **Загрузка модели через `webkitdirectory`-пикеры директорий** для рассыпанных glTF-наборов — хрупко и завязано на браузер. **Стандартизируем на single-file GLB (и опционально ZIP).**
9. **Декали логотипа компонуются на клонированные пер-меш-канвасы** с самописной drag-математикой (`sensitiveMove`, `pixPerCm`) — накапливает канвасы и клонирует материалы; риск утечек памяти. **Чище — нормальный Three.js `DecalGeometry`/decal-материал.**
10. **Серверные эндпоинты вброшены как непрозрачные `R2D.URL.*`** без версионной дисциплины (`/api`, `/api2`, голый `/renders_2k_4k/`, `/panoramas_360/` вперемешку). **Определяем одну версионированную документированную API-поверхность.**

---

## Confidence & gaps

**High (вычитано из кода дословно):** трёхшаговый контракт всех платных выходов (zip-снапшот → task-эндпоинт → поллинг статуса); ценовая лестница `rendersPrices {2k:1,4k:2,360:4}` и AI=1 (`Main.jsx:424-428`); тело `makeRender`/`makeExport` POST и форма ответа `{status, data:{renderId|exportId}}`; статус-машина рендера: in-progress `waiting/created/rendering/taken/start/finished`, терминальные `stored`(успех)/`error`, служебный `deleted` (`finished` — не терминальный, поллинг не стопается); интервалы поллинга (15 с рендеры, 500 мс AI, 2 с кредиты); лимиты загрузок (модель ≤60 МБ/≤60k тр./≤50 частей; картинки ≤20 МБ; форматы файлов); нормализация в GLB на клиенте + двойной пост `URL_UPLOAD_FILE`+`URL_UPLOAD_ENTITY`; путь `URL_UPLOAD_PRIVATE` для материала/ковра/постера с `type_id`; AI create/checkStatus с готовностью по `entityId`; PDF на клиенте (`R2D.pdfCreator.createView2D`) vs 3D на сервере; поллинг серверного экспорта 500 мс (`Export3DProjectPopup.jsx:624`, успех `status=='ok'`+file, ошибка `data.status==-20`) vs IFC без поллинга (событие `ifcStatus` код `'20'`); гейт экспорта по тарифу (3D→pro / 2D→basic-мягкий), а не кредитами (`not_enough_credits` в makeExport — клон-остаток от рендера); списание кредитов на сервере при сабмите рендера (`not_enough_credits`); туры как серверные сущности по хэшу `h` через postMessage-iframe; `RenderFrame` хардкод 16:9; закомментированный frustum-culling (user.js:1465-1470); параметры логотипа и `logoSrcList`/`logoFileNamesList` в сцене.

**Inferred (додумано из обращений к полям, не из схемы):** точная серверная JSON-форма item рендера и `ProductData`; контракт `/renders_2k_4k/` (реконструирован из имён констант + тел запросов, но не из спеки); что именно несёт `metaZip` при загрузке модели (SVG-параметры генерации плана? доп. LOD?); auth-детали (`x-token`-заголовок + `credentials:'include'` подтверждены для fetch-путей, но не для каждого XHR-вызова).

**Not found (нет в извлечённых ассетах):** литеральные строки `R2D.URL.URL_*` (эндпоинты server-injected в страницу — `R2D.URL = ${JSON.stringify(R2D.URL)}`, plannercore.js:24583; известны только _пути_ `/renders_2k_4k/`, `/panoramas_360/`, `/image_with_model_ai/`, `/switch_image/` из брифа/страницы); серверный рендер-движок (V-Ray/Cycles/Corona — opaque) и время/глубина очереди рендера; AI-бэкенд image→3D (какой сервис) — не идентифицируется из клиента; платёжный шлюз и точная цена кредит→валюта / по-региональная цена (приходят из `/api/credits/packets` в рантайме); серверная валидация загрузок.
