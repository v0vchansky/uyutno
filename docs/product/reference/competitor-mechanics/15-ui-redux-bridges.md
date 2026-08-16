# 15 — React/Redux UI, панели/попапы и границы postMessage

> Реверс из React-бандла (`RS = src/react_src/planner_front/src/js`, 190 файлов приложения), Redux-стора и движка `plannercore.js` (не минифицирован, 81349 стр.). Единицы сцены — см; экранные пороги — px. Это **референс чужой механики**, а не наше продуктовое решение — из него мы выведем собственную feature-спеку, код конкурента не копируем.
>
> Сокращения путей: `RS = src/react_src/planner_front/src/js`, `JSX = RS/react/jsx`, `SLICE = RS/redux/features`. Ядро движка — `js/plannercore.js`, аккаунт-слой — `js/user.js`.
>
> В `00-overview.md` уже сказано: «движок отделён от UI, React — тонкий контроллер поверх фасада (`R2D.createPlannerAPI` → `apiScene`/`apiConstr`)». Эта секция **уточняет и раскрывает** это утверждение: «отделён» ≠ «в другом окне». Наоборот — React и движок живут в **одном** документе и общаются напрямую через внутрипроцессную шину. postMessage существует, но только на шести _других_ межоконных границах.

---

## Главный факт: React-UI и движок R2D — одно окно, одна шина (НЕ postMessage)

Самый важный архитектурный урок этой секции, ведём с него.

`init.js` (`RS/init.js`) создаёт `user = new R2D.UserCore()` и `planner = new R2D.PlannerCore(user)` как обычные глобалы. React-компоненты **импортируют** `{ planner, user }` и зовут методы движка синхронно (`planner.scene.*`, `planner.mih()`, `R2D.scene.*`, `WC.wallsEditor.*`). Движок зовёт _обратно_ в React через **шину событий EventDispatcher**, выставленную как `planner.apiScene` / `planner.apiConstr`. Никакой сериализации, никакого postMessage. Canvas буквально вставляется в React-div: `canvasWrapper.appendChild(planner.getDomElement())` (`JSX/Main.jsx:972`).

**Вывод для нас:** держать связку движок↔UI внутрипроцессной (типизированный event-emitter / store-bridge), а postMessage резервировать строго под настоящие кросс-ориджин встраивания. «React и движок говорят через postMessage» здесь **ложно** — не тиражировать это заблуждение.

### Внутрипроцессная шина — реальный «мост» UI↔движок

`R2D.createPlannerAPI(planner)` (`plannercore.js:600`, вызывается как `R2D.createPlannerAPI(me)` `:30`) — **мутатор без `return`**: навешивает фасад прямо на переданный `planner`. Итого **7 неймспейсов** (`scene, view3d, view2d, viewWalk, constr, units, renders`; `:602-608`), из которых EventDispatcher-ами являются ровно два — `scene` (`:602`) и `constr` (`:606`); остальные пять (`view3d/view2d/viewWalk/units/renders`) — простые `{}` с методами. Плюс на верхний уровень `planner` вешаются не-неймспейсные методы (`zoomIn/zoomOut/fullscreen/toCenter/…`, `:610+`):

```
planner.scene = planner.apiScene = new EventDispatcher();   // plannercore.js:602 (EventDispatcher)
planner.constr = planner.apiConstr = new EventDispatcher(); // :606 (EventDispatcher)
planner.view3d/view2d/viewWalk/units/renders = { ... }      // :603-608 (простые {})
planner.mih = () => R2D.MouseInteractionHelper._instance;   // :610
```

`EventDispatcher` (`plannercore.js:8330-8410`) — самописный add/remove/dispatch с GC занулённых слотов (`_maxEventsNullCount=1000`). События — `new Event(type, data)`; слушатели читают `e.data`.

**Командная поверхность (React → движок): прямые методы** на `planner.scene` / `planner.constr` (объявлены `plannercore.js:612-900+`). Репрезентативный срез:

- Scene: `undo/redo/canUndo/canRedo`, `createNewScene`, `saveProject`, `loadProject`, `clear`, `removeCurrentModel/Group`, `duplicateCurrentModel/Group`, `flipCurrentModelX/Z`, `startRotateCurrentModel`/`rotateCurrentModel(deg)`/`stopRotateCurrentModel`, `startElevateCurrentModel`/`elevateCurrentModel(h)`, `mergeCurrentGroup`, `getCurrentModelRotation`, `makeElementVisible/Hidden`, `getCatalogProducts/setCatalogProducts`, `getPanorams/setPanorams`.
- Constructor: `stateMakeWall/Rect/Room`, `stateCutRoom`, `stateMakeCover/CutCover`, `stateMakeArea`, `finish`, `deleteSelected`, `alignPlan/stopAlignPlan/deletePlan/hasPlan`, `undo/redo`, `zoomIn/Out`.
- Viewers: `zoomToMax/zoomIn/zoomOut/toCenter/fullscreen/addRuler`, `view3d.activate()` и т.п.

**Событийная поверхность (движок → React): именованные константы** на `planner.scene.*` (два блока: `plannercore.js:772-775` + `:823-880`, до `PRELOADER_TOGGLE` включительно; между блоками — методы) и `planner.constr.*` (`:680-717`). Полный словарь, на который UI подписан (из `useEffect`-блоков `Main.jsx:939-1300`):

| Направление | Константа события (значение)                                                                                             | Реакция UI (хендлер в Main.jsx)                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| движок→UI   | `SET_ACTIVE_PRODUCT` (`setActiveProduct`)                                                                                | `onSetProductActive` → режим `selectedModel` + quick-панель `helper_model` (`:766`) |
| движок→UI   | `SET_ACTIVE_GROUP` (`setActiveGroup`)                                                                                    | `onSetGroupActive` → режим `selectedGroup` + `helper_group` (`:759`)                |
| движок→UI   | `RETURN_TO_DEFAULT_MODE`                                                                                                 | восстановить `prevControlPanelMode`/furniture (`:774`)                              |
| движок→UI   | `OBJECT_DRAG_OUT_OF_WALL`                                                                                                | назад в browse-режим (`:719`)                                                       |
| движок→UI   | `QUICK_PANEL_SHOW/HIDE`, `QUICK_PANELS_HIDE`                                                                             | показать/убрать quick-панели (`:849-851, 739`)                                      |
| движок→UI   | `PROJECT_LOADED`                                                                                                         | `onProjectLoaded` — гидратация view mode, pano, name, plan (`:295`)                 |
| движок→UI   | `PROJECT_SAVE_COMPLETE`                                                                                                  | обновить project user key (`:717`)                                                  |
| движок→UI   | `UPDATE_LOAD_STATUS`                                                                                                     | попап прогресса загрузки продукта (`:344`)                                          |
| движок→UI   | `RENDERS_UPDATE`                                                                                                         | тост «рендер готов / ошибка» (`:290`)                                               |
| движок→UI   | `HISTORY_UNDO_REDO`                                                                                                      | сброс quick/dynamic-панелей, `changeUndoRedo` (`:358`)                              |
| движок→UI   | `WHEEL_ZOOM` / `CAMERA_MOVE`                                                                                             | управление камерой вьюера (`:379, 396`)                                             |
| движок→UI   | `UPDATE_PROJECT_ONLY_VIEW_STATUS` / `UPDATE_PROJECT_NAME`                                                                | гейт view-only / переименование (`:807, 824`)                                       |
| движок→UI   | `SHOW_ALERT_POPUP`, `PASTE_PREMIUM_PRODUCT_ERROR`                                                                        | alert-попапы (`:854, 826`)                                                          |
| движок→UI   | `CHECK_IS_LOGGED`, `TRY_LOG_OUT`                                                                                         | ре-авторизация / логаут-сайд-эффекты (`:856, 874`)                                  |
| движок→UI   | `RULER_SELECTED`, `PRELOADER_TOGGLE`, `ESTIMATION_SEND`                                                                  | панель удаления линейки / прелоадер / смета (`:852, 932, 729`)                      |
| движок→UI   | `TIPS_*` (`TIPS_SAVE_PROJECT`, `TIPS_UPLOAD_CUSTOM_MAT`, `TIPS_MERGE_GROUP_BUTTON`, `TIPS_PANORAMS`, `TIPS_RENDER_MAKE`) | триггер coach-mark подсказок (`:258-288, 1260-1272`)                                |
| движок→UI   | constructor `USE_TAB_TIP_*` / `USE_ENTER_TIP_*` (с `e.data.position`)                                                    | позиционирование клавиатурных подсказок (`:741-757`)                                |

Это **шина событий, не request/response.** Команды — fire-and-forget вызовы методов, возвращающие синхронно (или Promise для async I/O вроде `saveProject`); изменения состояния броадкастятся обратно событиями. Нет correlation-id / механизма ответа.

---

## Шесть границ postMessage, которые ДЕЙСТВИТЕЛЬНО существуют

Внутрипроцессная шина (`apiScene`/`apiConstr`) — **не** postMessage, это внутренний EventDispatcher в одном окне. Настоящий межоконный `postMessage` используется на **шести** отдельных внешних границах:

1. **Документ планировщика ⇄ внешний фрейм мерчанта/хоста — исходящий.** `R2D.postMessageToParent` (`plannercore.js:10195`); в React-нотификациях `program_ready/project_saved/got_estimation/merchant_login`. Весь планировщик (React+движок) может быть встроен как `<iframe>` в сайт партнёра («мерчанта»).
2. **Документ планировщика ⇄ внешний фрейм мерчанта/хоста — входящий.** `messageListener` в `Main.jsx:404` (`load_project/set_token/save_project/export_project` и др.).
3. **Планировщик ⇄ встроенный app-iframe конфигуратора товара — `appMessageListener`** (`plannercore.js:24719`); IN `conf_ready/insert_to_planner/close`, OUT `start_configurate`.
4. **Планировщик ⇄ legacy ZIP-конфигуратор** — отдельный локальный `messageListener` (`plannercore.js:24478`, за хоткеем Ctrl+Alt+C).
5. **Платёжные попапы ⇄ iframe формы оплаты** — `PayProPopup.jsx` / `BuyCredits.jsx` (`buy_finish` / `credits_buy_finish`).
6. **Tour360-билдер ⇄ iframe** — `Tour360Create.jsx` (`tour_360_save` / `cancel`).

> Границы 1 и 2 — одна и та же host-граница, но это **два разных слушателя/направления** (исходящий `postMessageToParent` и входящий `messageListener`); ниже они разобраны вместе как «граница мерчанта/хоста».

**НЕ postMessage** (частые ложные кандидаты): (а) внутрипроцессная шина `apiScene`/`apiConstr` — внутренний EventDispatcher, одно окно; (б) `@paciolan/remote-component` — качает JS-бандл (zip→blobURL) и рендерит инлайн, никакого межоконного обмена (см. ниже); (в) web-worker `postMessage` — отдельный внутренний канал, не межоконный.

### Границы #1+#2 — планировщик ⇄ фрейм мерчанта/хоста (исходящий + входящий)

`R2D.postMessageToParent(str)` (`plannercore.js:10195`) → `window.parent.postMessage(str,'*')` (no-op, если не во фрейме). Все пейлоады — `JSON.stringify({action, ...})`. Входящее обрабатывает `messageListener` (`Main.jsx:404-715`).

**Хост → планировщик (входящий) словарь команд** (`dataObj.action`):

| action                                                      | payload                       | эффект                                                             |
| ----------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------ |
| `load_project`                                              | `{hash}`                      | `planner.scene.loadProject(hash, true)` (`:446`)                   |
| `set_token`                                                 | `{token}`                     | сохранить токен, ре-проверить логин, ре-арм автосейва (`:454`)     |
| `set_country`                                               | `{country}`                   | `R2D.controller.setCountry`, перезагрузка дерева каталога (`:480`) |
| `save_project` / `save_as`                                  | `{projectName?, exportType?}` | сейв с гейтом плана/лимита (`:498, 576`)                           |
| `rename_project`                                            | —                             | переименование (`:554`)                                            |
| `new_project` / `clear_project`                             | —                             | new/clear с гардом save-before (`:562, 575`)                       |
| `export_project`                                            | `{exportType?}`               | открыть export-попапы, гейт по плану (`:636`)                      |
| `open_renders` / `open_tours` / `create_tour` / `open_tour` | `{url?}`                      | попапы рендеров/360 (`:667-714`)                                   |
| `save_estimation` / `get_estimation`                        | —                             | смета в файл / `postMessageToParent(got_estimation)` (`:470`)      |

**Планировщик → хост (исходящие) нотификации:**

| action                 | payload            | когда                                                                         |
| ---------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `program_ready`        | —                  | после полного init (`Main.jsx:1190`)                                          |
| `merchant_login`       | —                  | любое действие с логином при `enable_merchant_login` (33 standalone-вхождения) |
| `project_saved`        | `{id, name, hash}` | после сейва (`Main.jsx:436, 544, 623`)                                        |
| `project_renamed`      | `{...}`            | после переименования (`SetProjectNamePopup.jsx:250`)                          |
| `set_project`          | `{projectId}`      | при `enable_set_project` (`plannercore.js:15697, 16160`)                      |
| `my_projects`          | —                  | при `my_projects_merchant_logic` (`StartPopup.jsx:256`, `UserButton.jsx:216`) |
| `product_details_show` | `{id}`             | при `product_details_show_merchant_logic` (`selectedModel/main/Main.jsx:808`) |
| `got_estimation`       | `{data}`           | ответ на `get_estimation` / на `ESTIMATION_SEND` (`Main.jsx:475, 732`)        |

Поведение **управляется конфиг-флагами** (`R2D.config.data.enable_merchant_login`, `enable_set_project`, `enable_estimation`, `enable_pro`, `my_projects_merchant_logic`, `product_details_show_merchant_logic`, `custom_registration`, `start_popup.*`). Когда мерчант встраивает планировщик, эти флаги перенаправляют логин, «мои проекты» и клики по деталям продукта наверх, в хост, вместо собственных попапов планировщика.

### Граница #3 — встроенный app-iframe конфигуратора мебели

`R2D.createAppIFrame()` (`plannercore.js:24844`) создаёт дочерний iframe на `${DOMAIN}/planner/configurator_launcher?site_key=…` для продуктов с дескриптором `applications` (`advancedFurniture` во весь экран, или `moduleFurniture` — правый док 270px; выбор через `getAppName` `:24908` / `getAppSrc` `:24917`). Хендшейк (`appMessageListener` `:24719`):

- child→parent `conf_ready` → parent→child `start_configurate` `{appName, appSrc, appVersion, modelId, configInfo{params{width,height,depth,elevation}, materials}, isPlanner:true}` — или `models[]` для группы (`:24731-24795`).
- child→parent `insert_to_planner` `{configInfo | groupConfigInfo[]}` → `R2D.replaceObjectWithConfigModel(view3dObject, configInfo)` (`:24799`).
- child→parent `close` → удалить iframe, `scene.history.saveState()` (`:24816`).
- child→parent `check_parent` → parent отвечает `{action:"parent"}` (`:24833`).

Оба слушателя защитно игнорируют `framebus`-фреймы и не-строковые данные (`if(...e.data.startsWith('/*framebus*/')) return`, `:24720` / `Main.jsx:405`).

### Граница #4 — legacy ZIP-конфигуратор

Легаси `createAppIFrameOld` (`:24451`) пишет HTML из zip в iframe; его собственный локальный `messageListener` (`plannercore.js:24478`, доступ за хоткеем Ctrl+Alt+C) использует `app_ready`→`set_data{url_files,url_entities,url_products,url_materials,url_apps,token,lang,product_id,scene_data}`, затем `app_save{product_id,settings}` / `app_close`. Это отдельная от #3 postMessage-граница со своим протоколом. Рядом живёт второй дев-хоткей **Ctrl+Alt+L** (`:24599`) — тот же конфигуратор, но грузящийся с localhost (дев-режим).

### Граница #5 — iframe формы оплаты

Pay/credits-попапы встраивают биллинг-форму как вложенный iframe и слушают колбэки `buy` / `buy_finish` / `credits_buy_finish` / `upgrade` / `close` (`JSX/components/popups/PayProPopup.jsx:134-384`, `BuyCredits.jsx:421-484`). `PayProPopup` — полноэкранный iframe на `/{lang}/pricing_iframe/`, **поллит** бэкенд каждые 2с, пока новый план не отразится, затем перезагружает. `BuyCredits` — iframe `/api/credits/get_form`, поллит `user.credits()` до изменения.

### Граница #6 — iframe Tour360-билдера

Tour360-билдер встроен как iframe; `Tour360Create.jsx` слушает колбэки `tour_360_save` / `cancel` от него. Отдельная postMessage-граница со своим мини-протоколом.

### Не-postMessage механизм — remote-компоненты `@paciolan/remote-component`

`RemoteComponentMain.jsx` (+ `remote-component.config.js`). Некоторые продукты каталога несут прикреплённые «applications» — per-product React-микроприложения (конфигураторы). `RemoteComponentMain` тянет **ZIP приложения из `R2D.URL.DOMAIN`**, распаковывает в браузере (`JSZip`), извлекает `react/app.js`, оборачивает в `Blob` → object URL (кэшируется в `planner.getSavedApplications()`) и рендерит `<RemoteComponent url={blobUrl} data={...}/>`. Общие `react`/`react-jss` инжектятся через `remote-component.config.js`, чтобы remote переиспользовал host-React. Динамическая загрузка компонента в рантайме, **не** build-time federation. **Это не postMessage** — рендерится инлайн в том же окне, никакого межоконного обмена. (Отличается от iframe-конфигуратора границы #3 — это внутрипроцессный remote React-компонент.)

---

## Как Redux синхронизируется с движком

Redux (Redux Toolkit) — **зеркало UI-состояния, а не источник истины.** Движок владеет сценой; Redux держит _какая панель/режим/попап показана_ и денормализованную копию нескольких фактов движка (активный view mode, высота стен, имя/план проекта, состояние логина).

- **Движок → Redux:** событие движка срабатывает → бежит слушатель в `Main.jsx` (или панели) → он `dispatch`ит plain-экшен. Напр. `PROJECT_LOADED` → `dispatch(setActiveViewMode(...))`, `dispatch(setActiveProjectName(...))`, `dispatch(setProjectPlan(...))` (`Main.jsx:311-334`).
- **Redux → движок:** thunk или компонент зовёт движок напрямую _внутри_ dispatch-пути. Напр. reducer `viewModeSlice.setActiveViewMode` зовёт `planner[newMode].activate()` **внутри редьюсера** (`SLICE/viewMode/viewModeSlice.js:37`) — нечистый редьюсер, мутирующий движок как побочный эффект. Thunk `topPanelSlice.changeUndoRedo` читает `planner.scene.canUndo()` и т.п. (`SLICE/topPanel/topPanelSlice.js:12-24`). Thunk `languageChange` перезапрашивает каталоги и зовёт `planner.setCatalogProducts/Materials/Panorams` (`SLICE/language/languageSlice.js:35-52`).

Этот двунаправленный паттерн с сайд-эффектами в редьюсерах мощный, но задокументированная боль (см. «что не копируем»).

---

## 12 слайсов Redux Toolkit (состояние + владение)

Стор: `configureStore({reducer: combineReducers({...})})` (`RS/redux/store/store.js:17-28`). Внимание на рассинхрон ключ↔имя (**инверсия имён импортов**, дубль не вычищен): `constr`(имя `constr`), ключ `viewMode` ← `viewModeSlice_legacy` (legacy), ключ `viewMode_new` ← `viewModeSlice` (новый). Оба слайса разом проводные в проде. Всего **12 редьюсеров.**

### common (`SLICE/common/commonSlice.js`, имя `common`)

Глобальные флаги вьюпорта. initialState: `is3DRotationModeActive:false`, `searchAccordionStatus:false`, `rightPanelStatus:true`, `lockState:true`, `activePano:{id:0,previewImgSrc:'',rotation:0}`, `countryLoad:''`, `isThereHiddenElements:false`, `preloaderStatus:false`, `renderMakeState:{type:'interior',screen:'landscape',fromApply:false}`, `hiddenButtonWasShowed:false`, `isProjectBelongToLoggedUser:false`, `isProjectOnlyView:true`. Все сеттеры — `state.x = payload` (`:16-54`). Thunk-ов нет. **Владеет:** видимость правой панели, режим 3D-вращения, состояние вьюера панорам, прелоадер, цель рендера, гейт владения/view-only проекта.

### constr (`SLICE/constructor/constructorSlice.js`, имя `constr`)

initialState: `wallsHeight:0`, `minWallsHeight:0`, `maxWallsHeight:400`, `imagePlanUploadedType:null`. Экшены `changeWallsHeight`, `changeImagePlanUploadType`. **Владеет:** границы высоты стен + тип загруженной картинки-плана для конструктора.

### control (`SLICE/control/controlPanelSlice.js`, имя `controlPanel`) — FSM левой dynamicPanel

Верхний уровень: `activeName:'constructor'`, `prevName:''`, `controlPanelStatus:true`, `dynamicPanelStatus:false`, `dynamicToggleButtonStatus:false`, `categoryTreePanelStatus:false`, `dynamicPanelProductsPreviewViewType`/`dynamicPanelCatalogPreviewViewType` (backed localStorage), `animateFavoritesShow/HideStatus`, `dynamicPanelPrevButtonKeyTimeout:0` (`:6-16`).

Каждый **режим** — предрегистрированный под-объект `{history:[], breadCrumbs:[], isInControlPanel?, showCategoryTreePanel?}` (`:17-37`). Полный набор режимов: `furniture, decor, to2d3d, constructor, walk, favorites, search, userUpload` (персистентные табы, `isInControlPanel:true`) и `selectedModel, selectedGroup, selectedWall, selectedCover, selectedPlinth, selectedOtherConstrParts, selectedArea, selectedCover_constr, replaceModel, renderMake, alignDrawing, uploadModel, wallSlice` (транзиентные контексты).

Несущий флаг — **`isInControlPanel`**: на переключении режима персистентные табы запоминаются через `prevName` и сохраняют `history`; транзиентным режимам `history`/`breadCrumbs` вайпается (`changeActiveControlPanelMode` `:40-70`). Навигационные редьюсеры ведут **параллельные стеки `history[]` + `breadCrumbs[]`**: `controlPanelHistoryAdd/AddArray/ReplaceArray/Remove/DataUpdate/Clear/ScrollSave/StateUpdate` (`:113-161`) и `controlPanelUpdateBreadCrumbs` с типами апдейта `add/addArray/replaceArray/remove/update/clear/home` (`:71-112`, хлебные крошки перестраиваются обходом `parentId`). Селекторы вкл. `selectActiveControlPanelMode`(→`activeName`), `selectActiveControlPanelModeData`(→`state.controlPanel[activeName]`), `selectPrevControlPanelMode`. **Владеет:** какой левый инструмент/таб активен + per-mode историей навигации по каталогу + хлебными крошками.

### language (`SLICE/language/languageSlice.js`, имя `language`)

initialState `{translation:{}, languages:[]}`. Три thunk-а: `languagesInit`→`user.loadLanguages()`; `translationInit`→`user.loadTranslation()`, затем **аппкейсит каждый ключ** в плоский dict `{"SOME_KEY":"text"}` (`:17-19`); `languageChange(code)`→ставит код, перезагружает перевод И перезапрашивает каталог/материалы/панорамы (локале-специфично) + сбрасывает breadcrumbs+history furniture/decor (`:24-55`). Селекторы `selectLanguages`, `selectTranslation`. **Владеет:** i18n-dict + список языков + сайд-эффектную перезагрузку каталога на переключении.

### metrics (`SLICE/metrics/metricsSLice.js` [sic], имя `metrics`)

initialState `{active:'cm', dimensionsAll:['cm','mm','m','ft']}`. Экшен `changeMetricsActive`. Зеркалит движковый `R2D.DimensionSystem`. **Владеет:** активная единица измерения.

### popups (`SLICE/popups/popupsSlice.js`, имя `popups`)

Реестр модалок. Верхний уровень `currentZindex:5`, `lastClosedPopup:''`, `currentActivePopups:[]` (**стек** имён открытых попапов) + **~48 записей попапов**, каждая `{status:false, zIndex:5, ...}` (`:5-56`). `setActivePopup({name, type?, data?, addData?, addType?, backBtn?, positionX?})` открывает попап, присваивает инкрементный z-index от вершины стека и пушит в `currentActivePopups` (`:58-75`). `closeActivePopup({name})` чистит его и фильтрует из стека (`:76-92`). `setPopupData` мутирует `.data` (`:93-96`). **Много попапов могут быть открыты одновременно** (слоями). `projectDataLoadPopup` опт-аутится через `customZIndex:true`. **Владеет:** весь стекируемый модальный слой.

### quickPanels (`SLICE/quickPanels/quickPanelsSlice.js`, имя `quickPanels`)

`active:''`, `prevActive:''`, `panels:{helper, delete, helper_model, helper_group, helper_plinth, helper_carpet, helper_portrets, helper_logo_mesh}`, каждая `{status, visible, position:{}, type}` (`:5-17`). Экшены `showQuickPanel`, `removeQuickPanel(All)`, `hide/show/toggleQuickPanelVisible`, `updateQuickPanelPosition`. **Владеет:** плавающие контекстные тулбары, привязанные к выделенному объекту.

### tips (`SLICE/tips/tipsSlice.js`, имя `tips`)

`lastTriggerTime:Date.now()` + 11 подсказок, каждая `{status:false, showed:false}`: `constructorButtons, panorams, selectGroup, mergeGroupButton, changeWallHeight, saveProject, uploadCustomMat, replaceModel, tipUseTab, tipUseEnter, tipRenderMake`. `showTip` ставит status; `hideTip` ставит `showed:true` (раз-за-сессию) + бампает `lastTriggerTime` (rate-limit). **Владеет:** одноразовые coach-mark тултипы. (Глобальный опт-аут живёт в `userProfileData.tips`, server-side.)

### topPanel (`SLICE/topPanel/topPanelSlice.js`, имя `topPanel`)

initialState — три объекта `{canUndo:false,canRedo:false}` для `constr`, `scene`, `tileConfig`. Thunk `changeUndoRedo` читает `viewMode_new.active`, затем запрашивает соответствующую историю движка (`planner.constr/scene.canUndo/canRedo`, или tile-config-редактор) (`:4-28`). **Владеет:** enabled-состояние кнопок undo/redo per editing context, зеркалит из движка.

### user (`SLICE/user/userSlice.js`, имя `user`)

initialState `{logged:false, profile:{}, projectActive:{name:null, plan:'free'}}`. Thunk `userLogout`→`user.logout()`; экшены `saveLoggedStatus`, `setProfileData`, `setActiveProjectName`, `setProjectPlan`. **Владеет:** сессия + имя/план подписки активного проекта.

### viewMode (LEGACY) vs viewMode_new — недоделанный рефактор

**Путано: файл с именем `_legacy` зарегистрирован под простым ключом `viewMode` и это толстый, всё ещё активный редьюсер;** не-легаси `viewModeSlice.js` зарегистрирован как `viewMode_new` и это слим-переписка.

- **`viewMode` (legacy, `SLICE/viewMode/viewModeSlice_legacy.js`, имя `viewMode`):** `active:'view3d'` + пять per-mode под-деревьев (`view3d, view2d, constr, viewWalk, tileConfig`), у каждого `activeState` и много именованных «state»-бакетов, держащих собственные `history`/`breadCrumbs` (`:6-75`). 12 редьюсеров вкл. `setActiveViewMode`, `setActiveViewModeState` (с большим teardown при выходе из `stateRenderMake` — `offClipping`, сброс камеры, `changeIsRenderActive(false)`, `checkSkybox`, `:152-167`), плюс полный history/breadcrumb API. Владеет _глубокой_ per-mode/per-substate историей навигации.
- **`viewMode_new` (`SLICE/viewMode/viewModeSlice.js`, имя `viewMode_new`):** `active:'constr'`, `prevActive`, `prevActive3d` (`:6-10`). ОДИН редьюсер `setActiveViewMode` — сейвит/анселектит текущий объект движка, помнит, где ты был до голого 2D/3D-вида, и зовёт `planner[newMode].activate()` (`:12-40`); в редьюсере есть гард — для `tileConfig` `activate()` НЕ вызывается. Никакой history-машинерии.

`Main.jsx` и `TopPanel.jsx` оба импортят `selectActiveViewMode`/`setActiveViewMode` из **нового** слайса — то есть «в каком я режиме» выковыривается из монолитного legacy-слайса в `viewMode_new`, пока history/breadcrumb-заботы всё ещё живут в legacy. **Недоделанный рефактор, оставленный в проде с обоими сторами проводными.** Боль, которую НЕ повторять.

---

## App shell, панели, попапы, quick-панели, подсказки

### Layout (`Main.jsx:1327-1440`)

Flex-строка: `<LeftMain/>` | `plannerMain{ TopPanel (справа сверху), RightPanel (правый slide-in), BottomPanel, CenterPanel(canvas) }` | `<Popups/>` + `<QuickPanels/>` + плавающие `<Tip/>`. framer-motion анимирует top/right-панели in/out; они прячутся в `viewWalk` / `renderMake` / `alignDrawing`.

| Регион | Компонент                                  | Назначение                                                                                                                                             |
| ------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Left   | `left_new/LeftMain.jsx`                    | 40px control-rail + toggle-кнопка + опц. CategoryTreePanel + mode-switched DynamicPanel (310px / 190px телефон)                                        |
| Top    | `top/TopPanel.jsx` (`buttons/Buttons.jsx`) | Язык, Projects-дропдаун (Save As/New/Share/Clear/Rename/Export), HD-рендер, Save, Undo/Redo, Send-a-request. View-only показывает только Язык+Projects |
| Center | `center/CenterPanel.jsx`                   | `<div id="planner">` хост canvas; роутит пики в режимы `selected*` + quick-панели                                                                      |
| Bottom | `bottom/BottomPanel.jsx`                   | Zoom in/out/%, ToCenter, Ruler, Metrics(единицы), FullScreen. Скрыт в walk                                                                             |
| Right  | `right_new/RightPanel.jsx`                 | Переключатель view mode (2D/3D/Constructor) + Settings/ImagePlan/HiddenElements                                                                        |

### FSM левой dynamicPanel

`DynamicPanel.jsx` рендерит панель по `activeName` через большой тернарник (`DynamicPanel.jsx:45-94`), держа последние 1–2 панели смонтированными, чтобы уходящая доанимировалась (~600ms). Директории панелей под `left_new/parts/dynamicPanel/panels/`: `furniture, decor, constructor, walk, favorites, search, usersUploads` (browse); `selectedModel, selectedGroup, selectedConstr/{selectedWall,selectedCover,selectedPlinth,selectedOtherConstrParts}, constructor/{selectedArea,selectedCover,alignDrawing}, replaceModel` (selection); `renderMake, uploadModel, wallSlice` (task); общие блоки в `common/` (catalog, catalogMaterials, products, sets, material, colorPicker, cameraViews, changePlinth, logoEditor, closeModeBtn).

Навигация: кнопка **back** → `controlPanelHistoryRemove`; **breadcrumbs** → `controlPanelHistoryReplaceArray` + `controlPanelUpdateBreadCrumbs` (переполнение схлопывается в «…»); кнопка **toggle** → `updateDynamicPanelStatus` (авто-выбор `furniture` при открытии пустой); размер превью персистится в localStorage. Выбор 3D-объекта: событие движка → хендлер `Main.jsx`/`CenterPanel` → `changeActiveControlPanelMode({mode:'selected*'})` + `showQuickPanel({name:'helper_*'})`; снятие восстанавливает `prevName` (или `furniture`) + `removeQuickPanelAll()`.

### Quick-панели (контекстные тулбары)

`QuickPanels.jsx` монтирует хелперы по `.status` внутри framer-motion. Хелпер → кнопки:

| Хелпер         | Для                     | Кнопки                                                                               |
| -------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| HelperModel    | одиночный продукт       | Flip X/Z, Duplicate, Delete, More▸[Replace, Lock, Hide], Rotate(радиальная), Elevate |
| HelperGroup    | группа                  | Flip X/Z, Duplicate, Delete, More▸[Lock, Hide], Rotate, Elevate                      |
| HelperCarpet   | ковёр                   | Delete, More▸[Replace, Lock, Hide], Rotate                                           |
| HelperPortrets | настенный арт           | Delete, More▸[Replace, Lock, Hide], Elevate, Rotate                                  |
| HelperPlinth   | плинтус                 | Clear, Hide, Rotate                                                                  |
| Helper (база)  | стены/cover/caps/frames | Clear, Hide, Rotate, Move                                                            |
| HelperLogoMesh | лого на поверхности     | −/＋ размер лого, Move                                                               |
| Delete         | линейки / подтверждение | удалить линейку, иначе confirm-попап                                                 |

Позиционируются от мышиных координат движка (`position:{x:planner.mih().mouseX, y:planner.mih().mouseY}`), клампятся под top-бар (если `y<72` → `top:72`, `x+50..100`). Кнопки зовут `planner.scene.*` напрямую и оборачивают изменения в undo/redo-dispatch. Сверено против `HelperModel.jsx` и `QuickPanels.jsx`. (Механику позиционирования quick-панелей со стороны движка см. в `05-selection-transform-grouping.md` §3.)

### Реестр попапов (`JSX/components/popups/Popups.jsx`)

Каждый попап рендерится, когда `activePopup.<name>.status===true`. Полный набор (~48): auth — `login, registration, forgotPassword, updatePassword, customRegistrationPopup, registrationDonePopup, deleteAccountPopup`; project — `setProjectName, changeProjectName, saveBefore, confirm, projectsPopup, projectDataLoadPopup, autoSaveEnable`; profile/billing — `profile, payPro, upgradePlan, buyCredits`; share — `share`; renders/360 — `rendersAnd360Popup, tour360Create, renderMade, renderExample_360, renderExample_big, renderExample_small, renderExample4k`; export — `exportPopup, export2DProjectPopup, export3DProjectPopup`; upload — `uploadCustomModelPopup, uploadCustomMaterialPopup, uploadChoicePopup, uploadPlanPopup, uploadChoiceModelPopup, uploadModelAiInfoPopup, uploadCustomModelAiPopup, imageUpload`; onboarding — `startPopup, demoProjectsExample, tipsPopup`; utility — `alert, completeMessage, loadingMessage, setValueInput, alignerWidthSet, alignerWidthSetMetrics, revert3DRotationPopup`. Открытие/закрытие целиком через `setActivePopup`/`closeActivePopup`/`setPopupData`; слоями по z-index.

### Подсказки (tips)

`tips/Tip.jsx`: абсолютно-позиционированный пузырь + SVG-стрелка (8 direction-классов, small/large варианты), позиция `{x,y,from}`, текст через `translation[props.text]` (`dangerouslySetInnerHTML`), fade-in через `showTime` мс; dismiss на Enter/Tab/Esc/click → `hideTip` (ставит `showed`). Session-only «showed» в redux; глобальный опт-аут server-side (`userProfileData.tips`, чекбокс постит `show_tips`).

### Правый переключатель view mode

`viewModesButtons/{View2D,View3D,ViewConstr}.jsx` → `dispatch(setActiveViewMode('view2d'|'view3d'|'constr'))` (constr также сначала `removeQuickPanelAll()`). У Walk кнопки здесь нет — входится через загрузку проекта / левый rail (`viewWalk`). Значения redux: `view2d/view3d/constr/viewWalk`; строки `state` проекта `2d/3d/walk/constructor` мапятся в них в `onProjectLoaded` (`Main.jsx:311-328`).

---

## Tech stack

- **React** с `ReactDOM.render` + `React.StrictMode` (`react/app.js:136-162`) — legacy render API, не `createRoot` ⇒ React 17 или React 18-в-legacy-mode (бандл шипит `react-dom.production.min.js`).
- **Redux Toolkit** (`@reduxjs/toolkit`: `configureStore`/`createSlice`/`createAsyncThunk`) + `react-redux` + `redux-thunk`/`immer` (транзитивно).
- **react-router-dom v6** (`Routes`/`Route element=`, `basename={R2D.URL.REACT_BASEPATH}`; роуты `/`, `/project/*`, `/password_recovery/*`).
- **Стили: react-jss** (`createUseStyles`) — весь стайлинг CSS-in-JS, ни CSS-файлов, ни tailwind.
- **framer-motion** для enter-exit анимации панелей/попапов (`AnimatePresence`, `motion`).
- **Сборка: webpack** (дефайны `__APP__VERSION__`, `SENTRY_DSN`, `SENTRY_ENV`; `process.env.NODE_ENV`). Sourcemap-путь `webpack://planner_front/...` в этой копии бандла **не найден** (unverified; единственные `sourceMappingURL` — inline от css-loader).
- **Sentry** (`@sentry/react` + `@sentry/tracing`, Replay) для error/session capture.
- Заметные либы: **swiper** (галереи рендеров), **simplebar-react** (кастом-скроллбары), **react-pdf** + **pdfjs-dist** (превью 2D PDF-экспорта; worker с unpkg CDN), **suneditor** (rich-text, лого-редактор), **next-share** (соц-шаринг; предположение по фингерпринту share-кнопок — код идентичен **react-share**, литерала имени в бандле нет, так что «next-share ИЛИ react-share»), **@paciolan/remote-component** (remote-микроприложения), **JSZip** (распаковка remote-бандлов), **lazysizes**, **lodash**, **classnames/clsx**.
- Сторона движка (глобальная, не-React): **three.js** (`three.min.js`) + сток `OrbitControls`, самописное `R2D.*` OOP-ядро (`plannercore.js`), `R2D.UserCore` (`user.js`).

---

## Что не копируем (anti-patterns)

1. **Не путать границы.** «React и движок говорят через postMessage» здесь **ложно** — общий window и внутрипроцессная шина. postMessage — только на 6 межоконных границах (host исх./вх., app-конфигуратор, legacy ZIP-конфигуратор, оплата, Tour360); `@paciolan/remote-component` и web-worker — **не** postMessage. В нашей переписке держать движок↔UI внутрипроцессным (типизированный event-emitter / store-bridge), а postMessage резервировать строго под настоящие кросс-ориджин встраивания.

2. **Redux — зеркало, а не источник истины, но редьюсеры тут зовут движок.** `viewModeSlice.setActiveViewMode` зовёт `planner[mode].activate()` _внутри редьюсера_ (`viewModeSlice.js:37`); нечистые редьюсеры ломают time-travel/devtools и делают порядок хрупким. Сайд-эффекты движка — в thunk/middleware, никогда в редьюсер.

3. **Два view-mode-слайса работают разом** (`viewMode` legacy + `viewMode_new`) — недомигрированный рефактор уехал в прод. Дублированная истина «активного режима» приглашает дрифт. Делать миграцию один раз; держать один mode-слайс.

4. **Параллельные стеки `history[]` + `breadCrumbs[]`, реконструируемые обходом `parentId`** есть _и_ в controlPanelSlice, _и_ в legacy viewModeSlice, с почти дублированной логикой add/remove/replace/clear. Крайне подверженно ошибкам. Моделировать навигацию как единое дерево/роут, крошки — выводить.

5. **~48 попапов как boolean-флаги в одном слайсе**, слоями через самописный z-index-счётчик. Предпочесть popup-стек/роутер с типизированными пейлоадами; не рассыпать 48 булевых.

6. **`enable_*` мерчант-конфиг-флаги перерутят core-флоу** (login, my-projects, product-details, set-project) наверх в хост-фрейм. Мощно для white-label, но ветвление (`config... ? postMessageToParent(...) : dispatch(...)`) дублируется в ~33 местах. Централизовать решение host-vs-local за одним адаптером.

7. **String-keyed `action`-протоколы с `JSON.parse` + try/catch и `'*'` targetOrigin** на каждой границе — ни схемы, ни проверки origin (security smell). Использовать типизированные сообщения и настоящий target origin.

8. **`R2D.*` / `WC.*` глобалы, достигаемые из глубины React-компонентов** (напр. `WC.WallsEditor._instance.zoom(...)` в `Main.jsx:385`). Нет границы зависимостей; рефакторинги расходятся волнами. Выставить один типизированный фасад движка и запретить тянуться мимо него.

9. **Гигантский `messageListener` (300+ строк) и 1400-строчный `Main.jsx`** концентрируют host-протокол, авторизацию, жизненный цикл проекта, разбор URL-query, подсказки и 15+ подписок на события в одном компоненте. Разбить по concern-ам.

---

## Confidence & gaps

**Высокая уверенность** (прочитано с номерами строк): внутрипроцессная природа связки UI↔движок (`init.js` глобалы, `appendChild` canvas, `createPlannerAPI` `:600-617`, `EventDispatcher` `:8330-8410`); полный event-словарь движок→UI и командная поверхность React→движок; все шесть postMessage-границ с их action-словарями (host исходящий `postMessageToParent` `:10195` + host входящий `messageListener` `Main.jsx:404-715`; app-iframe `createAppIFrame` `:24844` + `appMessageListener` `:24719`; legacy ZIP `createAppIFrameOld` `:24451` + `messageListener` `:24478`; платёжные iframe `PayProPopup/BuyCredits`; Tour360 `Tour360Create.jsx`); механизм `@paciolan/remote-component` (не postMessage); 12 слайсов Redux с полями initialState и владением; недоделанный рефактор `viewMode` vs `viewMode_new`; app shell / панели / ~48-попап реестр / quick-панели / tips; tech stack.

**Пробелы / средняя уверенность:**

- Точная схема `R2D.config.data` (какой мерчант поставляет `enable_*`, `start_popup.items`, `additional.orderFloorPlanUrl`) — живёт server-side, не в извлечённом бандле.
- Полная схема `configInfo`/`params`/`materials`, обмениваемая с iframe-конфигуратором, — определена внешним конфигуратор-приложением, не в этом бандле.
- Конечное состояние миграции `viewMode`: должен ли `viewMode_new` полностью заменить legacy или сосуществовать — из кода не следует.
- Режим `tileConfig` (tile-редактор) — упоминается в topPanel/viewMode, но его панели не было в извлечённом наборе `panels/`; вероятно отдельный remote-компонент.
- **Оговорка про JSX-якоря:** ссылки вида `Main.jsx:NNN` (и оценки «190 файлов», «~48 попапов») проверены **по литералам**, не по строкам — исходных `.jsx` нет, `react.js` минифицирован в 2 строки; всё проверяемое литералами сошлось, противоречий не найдено.

**Чего не хватает для реализации** (мост движок↔React для нас):

1. **Тайминги/порядок инициализации**: подписки vs `PROJECT_LOADED`, события до маунта — replay/буферизация или потеря (как у конкурента)? Решить в мосте.
2. **Схема пейлоада `e.data` каждого события** (level vs edge) — здесь есть только для `USE_TAB_TIP_*`; для типизированного моста нужна полная.
3. **Частотные характеристики** `WHEEL_ZOOM`/`CAMERA_MOVE`/`ROTATING_OBJECT` (per-frame?) и throttling — не разобрано; high-freq события держать вне Redux, иначе re-render-шторм.
4. **Reentrancy**: события синхронны из движка → dispatch внутри стека Three.js-обработчика; доставлять в React через микротаск.
5. **FSM селекции как протокол** (клик по другому объекту, selection во время drag) — не описан.
6. **Ошибки async-команд** (reject vs `SHOW_ALERT_POPUP`) — нужен единый Result-канал.
7. **Готовое решение**: типизированный emitter (mitt/nanoevents + TS-map событий) или `useSyncExternalStore` вместо ручного Redux-зеркала — закрывает анти-паттерны архитектурно.
