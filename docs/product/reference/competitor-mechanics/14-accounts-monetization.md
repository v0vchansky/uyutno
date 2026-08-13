# Механика редактора RoomToDo — 14. Аккаунты, аутентификация и монетизация

> **Что это.** Реверс-инжиниринг аккаунтной и денежной механики конкурента по не минифицированному `user.js` (`R2D.UserCore`, 3034 строки), `social.js`, React-попапам поверх `Main.jsx`-моста и относящимся к теме кускам `plannercore.js` (конфиг, GA/GTM, `ErrorReporting`, storage, автосейв). Это **референс чужой модели**, а не наши продуктовые решения — из него мы выведем собственные feature-спеки в `docs/product/features/`. Код не копируем; ниже поведение/правила своими словами с ссылками на реальные имена и номера строк как доказательство, что это из живого кода.
>
> Все номера строк относятся к `user.js` / `plannercore.js` / React-компонентам (пути указаны явно). Секция заканчивается блоком «Confidence & gaps» — что вычитано дословно, что додумано, чего не нашли.

---

## Обзор — бизнес-модель одним взглядом

У RoomToDo это **freemium + кредиты + подписка**, поверх которой натянута возможность **white-label / merchant-встраивания**.

- **Аккаунт.** Email+пароль, Facebook, Google. Сессия — bearer-**токен** (`x-token`), лежит в localStorage (`r2d_token`). Аккаунт **не нужен, чтобы пользоваться** планировщиком: анонимное («гостевое») редактирование работает полностью; **сохранение на сервер — первый жёсткий гейт** за логином.
- **Две ортогональные денежные механики** (это ключевая развилка — не смешивать):
  1. **Подписки** — `free` → `basic` → `pro` (плюс разовая покупка «premium project» на один проект). Гейтят: число проектов, премиум-товары каталога, шеринг «view-only», 2D-экспорт.
  2. **Кредиты** — расходуемая валюта, тратится **только** на облачные рендеры (2K / 4K / 360°). Скриншоты бесплатны.
- **White-label.** Серверный объект `config` превращает приложение во встроенную партнёрскую поверхность: делегирует логин (`merchant_login`) и «мои проекты» родительскому окну через `postMessage`, подсовывает кастомную форму сбора лида вместо регистрации и переключает почти любой элемент UI.

Всё аккаунтное состояние живёт в **ядре** (`R2D.UserCore`, singleton, импортируется как `user`), а React-слой зеркалит тонкий срез (`userSlice`: `logged`, `profile`, `projectActive.plan`). Это **двойной источник правды** и боль (см. «Что не копируем»).

**Бесплатный потолок — 3 проекта.** `free` показывает «использовано N из **3**» (ProjectsPopup), премиум-товары и «view-only»-шеринг закрыты, экспорт ограничен. `basic`/`pro` снимают потолки и открывают фичи по флагам (ниже).

---

## Технический дизайн

### Singleton `UserCore` и паттерн менеджеров

`R2D.UserCore` (`user.js:3`) — конструктор, хранимый как singleton (`R2D.UserCore._instance`, `user.js:229`). Внутри — ~20 суб-«менеджеров», по одному на концерн; каждый — замыкание над `user`, возвращает Promise и бьёт в один эндпоинт:

| Менеджер                                                                                                                                       | Ответственность                                                  | `user.js`     |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------- |
| `UserLogin`                                                                                                                                    | login / checkIsLogged / logout / профиль get+set                 | :695          |
| `UserPassword`                                                                                                                                 | смена / запрос восстановления / подтверждение                    | :2238         |
| `UserRegistration`                                                                                                                             | email-регистрация                                                | :2060         |
| `UserFacebook` / `UserGoogle`                                                                                                                  | соц-логин                                                        | :2416 / :2576 |
| `UserFavorites`                                                                                                                                | список/добавить/удалить избранное                                | :552          |
| `UserProjects`                                                                                                                                 | list / open / copy / delete / share-hash                         | :1113         |
| `UserRenders`                                                                                                                                  | list / open / delete / reload / **makeRender**                   | :1293         |
| `UserExport`                                                                                                                                   | 2D/3D-экспорт (гейт по **тарифу**: 2D→basic, 3D→pro; НЕ кредиты) | :236          |
| `UserSubscription`                                                                                                                             | отмена подписки                                                  | :453          |
| `UserAutoSave`                                                                                                                                 | тумблер флага автосейва                                          | :2980         |
| `UserAccount`                                                                                                                                  | удаление аккаунта                                                | :1009         |
| `UserPromo`                                                                                                                                    | погашение промокода                                              | :390          |
| `CameraViews`, `UserTours360`, `UserPano`, `UserLanguage`, `UserTranslation`, `RightPanelData`, `UserSearch`, `UserDimensions`, `UserSettings` | вспомогательные                                                  | разные        |

> **⚠️ Ров паттерна — не архитектура, а её отсутствие.** Каждый из ~20 менеджеров вручную повторяет один и тот же XHR-обвязочный танец (`R2D.XHRLoader`, `Event.COMPLETE/ERROR`, `JSON.parse`, проверка статуса). Примерно 2000 из 3034 строк `user.js` — копипаст. Это ровно то, что **не переносим** (см. ниже).

### HTTP-слой

`R2D.XHRLoader` (`user.js:2864`) оборачивает `XMLHttpRequest`. На каждый запрос автоматически подставляет заголовки `x-token` (из аргумента `token` или глобали `R2D.token`) и `x-lang` (`user.js:2895-2903`) и **успехом считает только HTTP 200** (`:2880`) — любой не-200 (включая 201/302) трактуется как ошибка. `getPostLoader` (`:2966`) форсит `application/x-www-form-urlencoded`, если вручную не толкнуть JSON-заголовок.

### Токен / сессия

- `saveToken(val)` пишет `R2D.token` + `R2D.Storage.save('r2d_token', val)` (`user.js:84`).
- `loadToken()` восстанавливает из storage при конструировании (`:90`, `:101`).
- `R2D.Storage` неймспейсит каждый ключ суффиксом site-key (`key_<siteKey>`, `plannercore.js:17776`), чтобы несколько встраиваний на одном origin не коллизили.
- **Поллер авто-логина/логаута:** `tryToAutoLoginOrLogOut` — `setInterval`, ре-валидирует хранимый токен, когда `R2D.isLoggedStatus == 'unlogged'` (`plannercore.js:16331`). `R2D.tokensLoadedWithError` помнит упавшие токены, чтобы не зациклиться на ретраях (`user.js:836, 840, 845, 850`).
- Токен может прийти **через postMessage** от родительского фрейма: `Main.jsx:455` ловит `dataObj.token` → `user.saveToken(token, false)` (не персистится) → `checkIsLogged()`. Это handshake merchant-SSO.

### Модель auth-состояния

`isLogged()` — это просто `data.id != 0` (`user.js:24`). Глобаль `R2D.isLoggedStatus` — строковый статус: `unlogged | loggingIn | logged` (выставляется через флоу логина). GTM `user_id` пушится при логине (`user.js:730`).

### Мост React ↔ ядро (postMessage)

React-приложение и iframe планировщика обмениваются JSON-сообщениями. Auth-релевантные исходящие из `Main.jsx`: `merchant_login`, `my_projects`, `project_saved`. Входящие: `{token}` (SSO), `{plan}` (ставит `projectActive.plan`). Успех логина в React-попапах ре-синхронизирует redux через `saveLoggedStatus` + `setProfileData` после вызова `user.*`.

---

## Модель данных

### `UserCore.data` (`user.js:7-19`, выставляется в `setUserData` `:27`)

```js
{
  id: 0,                 // 0 == гость; !=0 == залогинен (isLogged())
  email: null,
  name: 'User',          // фолбэк на email, если null/пусто (:53)
  key: null,             // "user key" — токен владения, штампуется в проект
  render: false,         // capability-флаг рендера ("1"/"0" с сервера)
  tips: true,            // показывать онбординг-подсказки
  token: null,           // bearer-токен (зеркалится в R2D.token)
  plan: "free",          // "free" | "basic" | "pro"
  credits: 0,            // баланс валюты рендера
  favorites: null,       // {total, items:[...]}
  autoSave: false,       // null=не спрашивали, true/false=выбор юзера
  maxProjects,           // потолок проектов (0 == безлимит); форсится в UI
  projectCount,          // текущее число сохранённых проектов
  // выводится из plan_features / user_plan_features (:44-51):
  walls:  bool,          // фича 'wall_editor'
  plinth: bool,          // фича 'plintus'
  add_mat:bool           // фича 'private_material' (загрузка своих материалов)
}
```

- `render`, `tips` приходят строками `"1"`/`"0"` и коэрсятся; `credits` используется и как число, и как строка (`+userData.credits` в UI).
- `key` — **штамп владения.** Сохранённый проект пишет `projectUserKey`; редактирование/сохранение сравнивает `getProjectUserKey() == user.getKey()`, чтобы решить право (`Main.jsx:513, 555`; `controller.applyAndSaveDataFromStorage` `plannercore.js:15845`).

### Redux `userSlice` (`userSlice.js:13`)

`{ logged:false, profile:{}, projectActive:{name:null, plan:'free'} }` — намеренно тонкий; `profile` — сырой серверный объект профиля; `projectActive.plan` трекает план **текущего открытого проекта** независимо от плана юзера.

### Избранное

`{ total:int, items:[{id, addData, ...}] }`. Add/remove мутируют `user.data.favorites.total` и `.items` локально после серверного вызова (`user.js:636-639, 685-688`). `addData` несёт опциональный **цветовой вариант**, так что один товар в разных цветах — разные избранные (`:604, :687`). Избранное грузится жадно на каждом логине / проверке сессии и мержится в `user.data.favorites`.

### Эндпоинты (через `R2D.URL.*`, инжектятся сервером как JSON — `plannercore.js:24583`)

- **Auth:** `URL_USER_LOGIN`, `URL_USER_REGISTER`, `URL_USER_INFO` (он же профиль), `URL_SIGN_OUT`, `URL_USER_LOGIN_SOCIAL` / `URL_SIGN_IN_VIA_FB` / `URL_SIGN_IN_VIA_GOOGLE`, `URL_RECOVERY_PASSWORD_REQUEST`, `URL_RECOVERY_PASSWORD_CONFIRM` (`{token}`), `URL_CHANGE_PASSWORD`, `URL_UPDATE_PROFILE`, `URL_DELETE_ACCOUNT`, `URL_CANCEL_SUBSCRIPTION`.
- **Деньги:** `URL_RENDER_NEW`, `URL_EXPORT_SCENE`, `/api2/exporter/status/{task}`, `/api/credits/packets`, `/api/credits/get_form`, `/api/premiumProject/get_form`, `URL_PAY_FORM`, `/{lang}/pricing_iframe/`.
- **Контент:** `URL_FAVORITES_GET/ADD/DELETE`, `URL_LOAD_ALL_PLANS`, `URL_SHARE_PLAN`, `URL_RENDER_ALL/GET/DELETE/RELOAD`, `URL_CAMERA_VIEWS`, `URL_360_TOURS_GET`, `URL_AUTO_SAVE_UPDATE`, `URL_CATALOG_SEARCH`, `URL_DELETE_PRIVATE`, `URL_SEND_PROJECT_CALC` (white-label лид), `URL_PLANNER_CONNECT`, `URL_PROMO` (`/api/user/promo?name=`).

> Литеральные пути этих констант в присланных файлах **отсутствуют** — таблица `R2D.URL` инжектится сервером. Подтверждены имена констант + метод (`POST`/urlencoded/`withCredentials`), но не сами URL.

---

## Аутентификация — флоу

- **Email-регистрация** (`UserRegistration.registration`, `user.js:2065`): POST JSON `{login, user_name, password, subscription_news}`. Клиентская валидация (RegistrationPopup): login 6–50, строгий email-regex, пароль 6–64, совпадение с повтором. Сервер может ответить `inactive_user` (нужна активация email) — код молча GET-ит activation-URL и просит юзера активироваться. На успехе → `RegistrationDonePopup` и `trySaveProjectToStorage()` (чтобы недоделанный гостевой проект не потерялся). GTM `register`.
- **Логин** (`tryLogin`, `user.js:700`): POST `{login, password}`. Сервер может вернуть `inactive_user`, `ERROR_TOO_MANY_ATTEMPTS` (rate-limit по логину **и** по IP) или общий invalid-credentials. На успехе: сохранить токен, **сразу подтянуть избранное** и смержить в данные юзера, запушить GTM `user_id`. После логина попап ветвится по «типу» (buy_plan → payPro, buy_credits → buyCredits, startPopup → projects, promoCredits → погашение промо) — логин используется как **гейт-развилка** для многих действий.
- **Забыл / сброс:** `recoveryPasswordRequest(email)` (`:2290`), затем `recoveryPasswordConfirm(data, token)` через PUT на `.../{token}` (`:2338`). Reset-ссылка открывает `UpdatePassword` в recovery-режиме, который чистит URL после успеха.
- **Смена пароля** (залогинен): `changePassword` (`:2243`), раздельные ошибки old-password-incorrect / new-equals-old.
- **Facebook** (`UserFacebook`, `user.js:2416`): `FB.login({scope:'email, public_profile'})` → `FB.api('/me')` → POST `{login, name, token, social_net:1}` на `URL_USER_LOGIN_SOCIAL`. `social.js` — почти дубликат легаси-версии, постит на `URL_SIGN_IN_VIA_FB`.
- **Google** (`UserGoogle`, `user.js:2576`): One-Tap (`google.accounts.id`) → POST `{credential}` на `URL_SIGN_IN_VIA_GOOGLE`.
- **«Custom registration»** (`CustomRegistrationPopup`) — это **НЕ** регистрация аккаунта, а **white-label форма сбора лида.** HTML формы инжектит хост (`R2D.getCustomRegistration()`, `plannercore.js:101`), сабмит постит проект + произвольные поля на `URL_SEND_PROJECT_CALC` через `R2D.sendRequestToCalc` (`plannercore.js:160`) — т.е. «отправь мой дизайн комнаты как заявку-расчёт в калькулятор реселлера». Пароли опциональны и валидируются, только если HTML партнёра их содержит.

---

## Монетизация

### Планы

`free`, `basic`, `pro` (+ разовая «premium project»). Серверный `user_plan_id`: basic=1, pro=2 (PayProPopup). Что гейтят:

| Фича                                    | Гейт                                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Сохранение проекта на сервер            | требует логина (`Main.jsx:499`)                                                                      |
| Число сохранённых проектов              | потолок `maxProjects`; free показывает «использовано N из **3**» (ProjectsPopup)                     |
| Премиум-товары каталога (`plan:['basic' | 'pro']` на товаре)                                                                                   | размещение/вставка/копирование премиум-объекта требует совпадающего плана (`Main.jsx:522-527, 14342-14344`) |
| Загруженные/свои модели (`isOwner`)     | free заблокировано; basic заблокировано для типа MODEL                                               |
| Шеринг «view only»                      | только pro (SharePopup)                                                                              |
| Экспорт проекта                         | по **тарифу**, НЕ кредиты: 2D→basic (мягкий гейт, поток не блокируется), 3D→pro (`Main.jsx:636-666`) |
| Recurring помесячно/погодно             | `RECURRING_PLANS[plan][month=1                                                                       | year=12]`                                                                                                   |

**Upgrade-воронка.** Превышение лимита или несовпадение плана диспатчит `upgradePlan` (мелкий confirm) → `payPro` (полноэкранный **iframe `/{lang}/pricing_iframe/`**). Все платёжные формы — **серверно-рендеренные same-origin iframe** (`get_form`, `URL_PAY_FORM`), получают `token`/`lang` query-параметрами; результат сигналится обратно через `postMessage` (`buy_finish`, `credits_buy_finish`). После покупки приложение **поллит** `checkIsLogged`/`loadProjects` каждые 2 с (макс 5 попыток), пока план/проект не переключится. Локализованные iframe-нотификации (`wait_/ok_/error_.html|php`).

> **Платёжный провайдер в клиенте не назван** — полностью абстрагирован за same-origin серверными iframe. «PayPro» — только внутреннее имя компонента, _не_ обязательно гейтвей PayPro Global (хотя нейминг намекает). Paddle/Stripe/PayProGlobal из клиентского кода не подтвердить → открытый вопрос.

### Экономика кредитов (единственная расходуемая валюта)

Тратится исключительно на облачные рендеры. Стоимость (`render`, `Main.jsx:424`):

```
2K рендер   = 1 кредит  (activeFormat 3)
4K рендер   = 2 кредита (activeFormat 4)
360° тур    = 4 кредита (activeFormat 5)
Скриншот    = БЕСПЛАТНО  (activeFormat 0, client-side canvas-экспорт)
```

`makeRender` (`user.js:1420`) зипует сцену (`content.json` + zip моделей + preview PNG), POST-ит на `URL_RENDER_NEW`; сервер возвращает `renderId` или `not_enough_credits`. UI пред-проверяет баланс и поднимает `BuyCredits`, если не хватает (`Main.jsx` render `:467-472`).

**Покупка кредитов** — через `BuyCredits`: пакеты тянутся из `POST /api/credits/packets`, UI показывает тиры **5/10/20/50/100** (дефолт 20), цена — _per-credit × count_ с сервера, оплата через iframe `/api/credits/get_form?credits=N&lang=&token=`. «Buy more» → `mailto:sales@roomtodo.com`. GTM: `choice_credit`, `order_credit`, `buy_credit`, `cancel_order_credit`.

---

## Автосейв и владение

Два независимых механизма (`plannercore.js`) — не путать:

- **Local-storage автосейв (гость-безопасный):** `trySaveProjectToStorage` (`:15806`) + `setInterval` на 5 с (`:16302`), пишет `r2d_project` / `r2d_project_<hash>`. Служит, чтобы пронести гостевую работу через стену логина и восстановить на reload (`tryLoadProjectFromStorage` `:15816`). Когда гость регистрируется/логинится, заначенный проект можно ре-применить к свежесозданному серверному проекту (`applyAndSaveDataFromStorage` `:15842`, под защитой `projectUserKey == user.getKey()`).
- **Server-автосейв (залогинен, opt-in):** `sceneAutoSaveServer(userKey)` (`:16317`) — `setInterval` на 60 с, зовёт `saveCurrentScene(null, true)` **только если** у проекта есть id, он менялся и `userKey == getProjectUserKey()` — т.е. автосейв **scoped на владельца.** Тумблер — флаг `autoSave` через `user.autoSaveUpdate({auto_save})`. `AutoSaveEnablePopup` спрашивает единожды (`user.data.autoSave == null`) сразу после первого удачного сохранения (`Main.jsx:543`).

---

## Гостевое / анонимное использование

Полностью работает без аккаунта: строить планировки, ставить мебель, скриншотить (бесплатно), локальный автосейв. **Жёсткие гейты за логином:** сохранение/переименование/копирование на сервер, «мои проекты», рендеры/360 (нужны кредиты, которым нужен аккаунт), шеринг, апгрейд. В merchant-режиме все эти гейты делегируются родительскому фрейму вместо показа внутри-аппового логина.

**Первый жёсткий гейт — серверное сохранение** (`Main.jsx:499`). До него граница монетизации не пересекается ни разу: весь путь build → screenshot проходится анонимно.

---

## White-label / merchant-встраивание

- Серверный `config` переключает почти любой элемент UI и включает merchant-режим.
- Логин делегируется родителю: исходящий `merchant_login` postMessage вместо внутреннего попапа; «мои проекты» — исходящий `my_projects`.
- SSO: родитель шлёт `{token}` внутрь iframe → `user.saveToken(token, false)` (не персистится) → `checkIsLogged()` (`Main.jsx:455`).
- Кастомная форма-лид (`CustomRegistrationPopup` + `R2D.getCustomRegistration()`, `plannercore.js:101`) постит проект-как-заявку на `URL_SEND_PROJECT_CALC` (`R2D.sendRequestToCalc`, `plannercore.js:160`).

### Второй, интеграционный API для мерчантов — `R2D.API.*`

**Не путать с `R2D.createPlannerAPI` (внутрипроцессная UI↔движок-шина, разбор в `15-ui-redux-bridges.md`).** `R2D.API` (`plannercore.js:17264`) — **отдельный публичный неймспейс для B2B-выгрузок и партнёрских интеграций**: набор синхронных read-геттеров, которые хост-сайт мерчанта вызывает поверх встроенного планировщика, чтобы вытащить из текущей сцены «свои» товары и смету. Это денежно-релевантная поверхность — то, ради чего мерчант вообще встраивает планировщик: **посчитать заказ по своему каталогу**.

Ключевой механизм — **фильтрация по `user_key` мерчанта** (`R2D.SP.userKey`), т.е. учитываются **только материалы/товары, принадлежащие этому мерчанту** (сверка `productData["user_key"] == userKey` через `R2D.Pool.getProductData`, `:17316-17325`), чужой контент из сметы исключён.

| Метод (`plannercore.js`)                                      | Что делает                                                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getConstructorInfoInCurrentProject()` (`:17302`)             | Площади **конструкторских** элементов мерчанта — `cap/walls/covers/ceilings/areas/cuts/frames` — как `[{productId, area, where}]`, только где `user_key == userKey` |
| `getProductsInfoInCurrentProject()` (`:17355`)                | Всё мерчант-принадлежащее в сцене: `{types, products[getProductInfo], constructor}` — товары (позиция/размеры/поворот/флипы/материалы) + конструктор-площади        |
| `getProductInfo(sceneObject)` (`:17266`)                      | Полная геометрия+материалы одного объекта (позиция, w/h/d, rotation X/Y/Z, flip X/Y/Z, `materials[{default,current,name}]`)                                         |
| `getConstructorEstimate()` (`:17391`)                         | **Смета** конструктора — `R2D.scene.constructor.getEstimate()`                                                                                                      |
| `setConstructionStyle(styleString)` (`:17381`)                | Применить стиль конструктора из JSON (запись, единственный не-read метод здесь)                                                                                     |
| `selectRoomByName(name)` / `unselectRoom()` (`:17401/:17411`) | Программный выбор комнаты по имени — хук для навигации хоста по сцене                                                                                               |
| `getProjectData()` / `getProductList()` (`:17421/:17426`)     | Сырой текст-дамп проекта / плоский список товаров с материалами                                                                                                     |

Все геттеры защитно возвращают `{}` при `!R2D.scene` или `!R2D.SP.userKey` (site-key не проброшен) — т.е. API «молчит», пока планировщик не встроен как мерчант-сайт с ключом. **Вывод для нас:** если делаем B2B-интеграцию/выгрузку сметы, это должен быть отдельный, явно версионируемый read-API с фильтром «только мой каталог по owner-key», а не тот же фасад, что гоняет UI.

---

## Аналитика и репортинг ошибок

- **`R2D.GA`** (`plannercore.js:17651`): классический `ga('send','event',...)` с событиями `planList/open`, `payForm/open`, `payFinish/open`, `payOK/open`, лейблованными **по origin** (`landing | iframe | demo | shared | empty`, `:17653`) — вскрывает paywall-воронку и то, что источник трафика (встроенный vs шаренный vs лендинг) — ключевое измерение. Глушится на dev-хостах.
- **GTM `dataLayer`** (React): `register`, `user_id`, `click_start_render`, `click_hd`, кредиты (`choice_credit/order_credit/buy_credit/cancel_order_credit`), планы (`order/buy/cancel_order`, `click_<plan>_<time>`), галерея (`click_gallery_render/360`). Это перечисляет **основные воронки конверсии:** build → render → buy credits и build → упёрся в лимит → upgrade plan.
- **`R2D.ErrorReporting`** (`plannercore.js:10714`): заглушка — `_send` просто `console.log`-ает (нет сетевого стока). Репорт содержал бы user id/key + project id/key. По факту **выключен** в этой сборке.

---

## Что не копируем (anti-patterns)

1. **Массовая копипаста XHR-обвязки.** Каждый из ~20 менеджеров заново лепит `new XHRLoader → addEventListener → JSON.parse → status-check → resolve`. ~2000 из 3034 строк `user.js` — копипаст. → Один типизированный API-клиент (axios/fetch-обёртка + zod), один конверт ошибки.
2. **Колбэки, обёрнутые в Promise, которые никогда не `reject`.** Ошибки `resolve({type:'error', data:'TEXT_...'})`. Вызывающие обязаны везде строково проверять `.type == 'error'` → легко забыть, нет типобезопасности. → Discriminated union / throw+catch.
3. **Двойной источник правды** для auth: `user.data` (ядро) vs `userSlice` (redux) ре-синкают вручную после каждой мутации (`saveLoggedStatus` + `setProfileData` в каждом попапе). → Один store, React-состояние — производное от него.
4. **Успех только по HTTP 200** (`XHRLoader:2880`) хрупок; любой редирект/201/rate-limit-страница ломает парсинг.
5. **Несогласованная валидация:** строгий email-regex в регистрации vs слабый `/^[^@]+@[^@]+$/` в forgot-password и custom-registration; правила пароля дублируются в 3 попапах.
6. **Серверно-инжектнутые глобали** (`R2D.URL`, `R2D.RECURRING_PLANS`, `R2D.config`, `R2D.customRegistration`, `fbApplicationId`, `googleClientId`) — без типов, magic strings; маппинг plan-id (basic=1/pro=2, month=1/year=12) размазан. → Типизированный конфиг-модуль.
7. **Платёжная логика раздроблена по попапам** (BuyCredits, UpgradePlan, PayProPopup — каждый дублирует поллинг + машинерию notification-iframe, 2 с × 5). → Один payment-сервис + postMessage/webhook state-machine.
8. **`R2D.token` зеркалится в трёх местах** (глобаль, `data.token`, localStorage) и вручную протаскивается в **URL** iframe (`&token=...`) — утечка токена в URL/referrer это security-запах. → HttpOnly-cookie или короткоживущий подписанный handoff.
9. **`ErrorReporting` — no-op** — продовые ошибки уходят в никуда. → Реальный Sentry-подобный сток с первого дня.
10. **Кредит/план-гейты форсятся клиентом** (для UX, `Main.jsx`) **и** сервером (render/paste возвращают ошибки) — дублирование рискует разъездом. Сервер держим авторитетным, клиентские проверки — только подсказки.
11. **Владение по строковому сравнению `key`** (`getProjectUserKey() == user.getKey()`) хрупко; чистый owner_id-FK лучше.
12. **Поллинг везде** (авто-логин каждые N с, статус рендера, результат оплаты, автосейв) вместо событий/websockets → расточительно и race-prone.

---

## Confidence & gaps

**High confidence** (вычитано из кода дословно, с номерами строк): паттерн singleton `UserCore` + список менеджеров и их эндпоинтов; модель `UserCore.data` и `userSlice`; флоу email/Facebook/Google-логина, forgot/reset, смены пароля; токен/сессия (`saveToken`/`loadToken`, `x-token`, `R2D.Storage` неймспейс, SSO-postMessage); матрица гейтов планов и триггеры (сохранение, `maxProjects`, премиум-товары, view-only, экспорт); экономика кредитов (стоимости 1/2/4, тиры 5/10/20/50/100, `makeRender` → `URL_RENDER_NEW` / `not_enough_credits`); оба механизма автосейва и их owner-scope; GA/GTM-события воронок; `ErrorReporting` = `console.log`-заглушка; интеграционный `R2D.API.*` (`:17264+`) с фильтром сметы/товаров по `user_key` мерчанта (`:17302, :17355, :17391`).

**Medium confidence / gaps:**

- **Платёжный гейтвей непрозрачен** — целиком спрятан за same-origin `get_form`/`pricing_iframe` серверными страницами. PayPro Global / Paddle / Stripe / кастомный merchant of record — из клиента не различить. Нужен серверный/сетевой захват.
- **Точная матрица планов** — `maxProjects`, ценовые точки и полный `plan_features` на тир приходят с сервера (`user_plan_features`); клиент ссылается только на `wall_editor`, `plintus`, `private_material`. Полная сетка фич неизвестна.
- **Цены пакетов кредитов** — динамические из `/api/credits/packets` (per-credit × 5/10/20/50/100); реальных долларовых значений в клиенте нет.
- **Литералы URL эндпоинтов** — `R2D.URL.*` инжектятся сервером как JSON (`plannercore.js:24583`); в присланных файлах самих путей нет. Подтверждены имена констант + метод (`POST`/urlencoded/`withCredentials`).
- **Флаг `render` vs кредиты** — `data.render` (boolean) существует отдельно от `credits`; вероятно легаси-capability «можно ли рендерить вообще», текущий эффект неясен.
- **Контракт merchant-SSO** — handshake `merchant_login` / token-postMessage с родительскими фреймами виден только со стороны iframe; **протокол на стороне родителя внешний** и здесь не прослеживается.
- **Промокоды** (`URL_PROMO`) выдают кредиты (login-ветка `promoCredits`); выпуск/лимиты — серверные.
