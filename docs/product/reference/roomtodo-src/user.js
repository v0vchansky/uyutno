if (! R2D) R2D = {};

R2D.UserCore = function()
{
    let me = this;

    me.data = {
        id:     0,
        email:  null,
        name:   'User',
        key:    null,
        render: false,
        tips:   true,
        token:  null,
        plan:   "free",
        credits: 0,
        favorites: null,
        autoSave: false
    };

    me.getKey = () => me.data.key;
    me.getId = () => me.data.id;
    me.isTipsOn = () => me.data.tips;
    me.isLogged = () => me.data.id != 0;
    me.credits = () => me.data.credits;

    me.setUserData = data => {
        me.data.id = data['id'];
        me.data.email = data['email'];
        me.data.name = data['name'];
        me.data.key = data['key'];
        me.data.render = data['render'] == "1";
        me.data.tips = data['tips'] == "1";
        me.data.plan = data['plan'];
        me.data.credits = data['credits'];
        me.data.favorites = data['favorites'];
        me.data.maxProjects = data["maxProjects"];
        me.data.projectCount = data['projectCount'];
        me.data.autoSave = data['autoSave'];

        if (data['token']) me.saveToken(data['token']);

        let features = null;
        if ('user_plan_features' in data) features = data['user_plan_features'];
        if ('plan_features' in data) features = data['plan_features'];
        if (features)
        {
            me.data.walls = features.includes('wall_editor');
            me.data.plinth = features.includes('plintus');
            me.data.add_mat = features.includes('private_material');
        }

        if ( me.data.name == null || me.data.name == '' ) {
            me.data.name = me.data.email;
            console.warn('User name have changed to user email');
        }

    };

    me.languages;

    me.clearUserData = () => {
        me.data.id = 0;
        me.data.email = null;
        me.data.name = 'User';
        me.data.key = null;
        me.data.render = false;
        me.data.tips = true;
        me.data.walls = false;
        me.data.plinth = false;
        me.data.add_mat = false;
        me.data.plan = "free";
        me.data.favorites = null;
    
        clearToken();
    };

    function clearToken()
    {
        R2D.token = null;
        R2D.Storage.clear('r2d_token');
    }

    me.saveToken = (val, saveInStorage = true) =>
    {
        R2D.token = val;
        saveInStorage && R2D.Storage.save('r2d_token', val);
    }

    function loadToken()
    {
        if (!R2D.token)
        {
            let token = R2D.Storage.load('r2d_token');
            if (token) R2D.token = token;
        }

        return R2D.token;
    }

    loadToken();

    EventDispatcher.call(this);

    me.LOGIN_COMPLETE = 'loginComplete';
    me.LOGOUT_COMPLETE = 'logoutComplete';
    me.LOGIN_ERROR = 'loginError';
    me.LOGOUT_ERROR = 'loginError';
    me.INCORRECT_PASSWORD = 'incorrectPassword';
    me.ACTIVATION_COMPLETE = 'activationComplete';
    me.ACTIVATION_ERROR = 'activationError';
    me.CHECK_COMPLETE = 'checkComplete';
    me.CHECK_ERROR = 'checkError';

    me.plannerConnect = async () => {
        return new Promise((resolve, reject) => {
            let url = R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_PLANNER_CONNECT);
            let loader = new R2D.XHRLoader();

            function eventHandler(event) {
                if (event && event.data) resolve(event.data.data);
            }

            loader.addEventListener(Event.COMPLETE, eventHandler);
            loader.addEventListener(Event.ERROR, eventHandler);
            loader.load(url, null, 'GET', null, null, true);
        })
    }

    let uLogin = new R2D.UserCore.UserLogin(me);
    me.tryLogin = async (l, p) => await uLogin.tryLogin(l, p);
    me.checkIsLogged = async token => await uLogin.checkIsLogged(token) ;
    me.logout = async () => await uLogin.logout();
    me.loadProfileData = async () => await uLogin.loadProfileData();
    me.setProfileData = async data => await uLogin.setProfileData(data);

    let uPassword = new R2D.UserCore.UserPassword(me);
    me.recoveryPasswordRequest = async email => await uPassword.recoveryPasswordRequest(email);
    me.recoveryPasswordConfirm = async (data, token) => await uPassword.recoveryPasswordConfirm(data, token);
    me.changePassword = async data => await uPassword.changePassword(data);

    let uFacebook = new R2D.UserCore.UserFacebook(me);
    me.facebookLogin = async () => await uFacebook.facebookLogin();

    const uGoogle = new R2D.UserCore.UserGoogle(me);
    me.googleLogin = async () => await uGoogle.googleLogin();

    let uRegistration = new R2D.UserCore.UserRegistration(me);
    me.registration = async data => await uRegistration.registration(data);

    me.LANGUAGE_UPDATE = 'languageComplete';
    me.LANGUAGE_ERROR = 'languageError';

    let uLanguage = new R2D.UserCore.UserLanguage(me);
    me.loadLanguages = async () => await uLanguage.load();
    me.setLanguageCode = async (languages, code) => await uLanguage.setCurrentCode(languages, code)

    let uTranslation = new R2D.UserCore.UserTranslation(me);
    me.loadTranslation = async () => await uTranslation.load();

    let uRightPanelData = new R2D.UserCore.RightPanelData(me);
    me.loadRightPanelData = async (url, country) => await uRightPanelData.load(url, country);
    me.rightPanelLoadClose = () => uRightPanelData.close();
    me.deleteMaterial = async params => await uRightPanelData.deleteMaterial(params);
    
    let uRenders = new R2D.UserCore.UserRenders(me);
    me.loadRenders = async (limit, offset) => await uRenders.load(limit, offset);
    me.openRender = async renderId => await uRenders.openRender(renderId);
    me.deleteRender = async renderId => await uRenders.deleteRender(renderId);
    me.makeRender = async renderObj => await uRenders.makeRender(renderObj);
    me.reloadRender = async renderId => await uRenders.reloadRender(renderId);
    me.showRenderFrame = () => uRenders.showRenderFrame();
    me.hideRenderFrame = () => uRenders.hideRenderFrame();

    let uProjects = new R2D.UserCore.UserProjects(me);
    me.loadProjects = async (limit, offset) => await uProjects.load(limit, offset);
    me.openProject = id => uProjects.openProject(id);
    me.copyProject = async project => await uProjects.copyProject(project);
    me.deleteProject = async id => await uProjects.deleteProject(id);
    me.projectHashLoad = async projectId => await uProjects.projectHashLoad(projectId);

    let uSubscription = new R2D.UserCore.UserSubscription(me);
    me.cancelSubscription = async () => await uSubscription.cancelSubscription();

    let uDimension = new R2D.UserCore.UserDimensions(me);
    me.changeDimension = dimension => uDimension.changeDimension(dimension);

    let uSettings = new R2D.UserCore.UserSettings(me);
    me.settingsItemClick = settingsItemName => uSettings.settingsItemClick(settingsItemName);

    let uPano = new R2D.UserCore.UserPano(me);
    me.loadPano = async () => await uPano.load();

    let uFavorites = new R2D.UserCore.UserFavorites(me);
    me.uGetFavorites = async () => await uFavorites.getList();
    me.uAddToFavorites = async (id, color) => await uFavorites.addToFavorites(id, color);
    me.uRemoveFromFavorites = async (id, color) => await uFavorites.removeFromFavorites(id, color);

    let uSearch = new R2D.UserCore.UserSearch(me);
    me.uGetSearchResult = searchQuery => uSearch.getSearchResult(searchQuery);

    let uPromo = new R2D.UserCore.UserPromo(me);
    me.promoLoad = async value => await uPromo.load(value);

    let uExport = new R2D.UserCore.UserExport(me);
    me.makeExport = async renderObj => await uExport.makeExport(renderObj);
    me.checkExport = async currentTask => await uExport.checkExport(currentTask);
    me.currentLoadingExportId = null;

    let uCameraViews = new R2D.UserCore.CameraViews(me);
    me.cameraViews_load = async projectId => await uCameraViews.load(projectId);
    me.cameraViews_save = async data => await uCameraViews.save(data);
    me.cameraViews_delete = async cameraViewsId => await uCameraViews.delete(cameraViewsId);

    let uTours360 = new R2D.UserCore.UserTours360(me);
    me.uTours360_load = () => uTours360.getTours();
    me.uTours360_delete = url => uTours360.deleteTour(url);

    let uAutoSave = new R2D.UserCore.UserAutoSave(me);
    me.autoSaveUpdate = async data => await uAutoSave.updateAutoSave(data);

    let uAccount = new R2D.UserCore.UserAccount(me);
    me.accountDelete = async () => await uAccount.delete();

    me.projectList = [];
    me.PROJECT_LIST_COMPLETE = 'projectListComplete';
    me.PROJECT_LIST_ERROR = 'projectListError';

    R2D.UserCore._instance = me;
};

R2D.UserCore._instance = null;

R2D.extend(R2D.UserCore, EventDispatcher);

R2D.UserCore.UserExport = function(user)
{
    let me = this;

    me.makeExport = renderObj => {
        return new Promise((resolve, reject) => {
            function handleRenderError(data) {
                if ( !data || !data.status || data.status !== 'error' ) {
                    return resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
                if ( data?.error === 'not_enough_credits' || data?.error === 'not enough credits' ) {
                    return resolve({type: "error", data: "TEXT_RENDERS_NOT_CREDITS"});
                }

                handleRenderError(null);
            }
            function uploadActionHandler(event) {
                if ( event.type === Event.ERROR ) {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
                if ( !event.currentTarget.data ) {
                    return resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
                if ( !event.currentTarget.data.status ) {
                    return resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
                if ( event.currentTarget.data.status !== 'ok' ) {
                    return handleRenderError(event.currentTarget.data);
                }
                resolve(event.currentTarget.data.data.exportId);
            }
            function uploadRenderData(data) {
                let loader = new R2D.XHRLoader();
                let headers = [{header: "Content-Type", value: 'application/json'}];

                let url = R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_EXPORT_SCENE);

                loader.load(url, data, "POST", headers, 'json', true);

                loader.addEventListener(Event.COMPLETE, uploadActionHandler);
                loader.addEventListener(Event.ERROR, uploadActionHandler);
            }

            function fillAnsZipProjectData () {
                let data = R2D.controller.scene.getSceneState(true);
                let preview = R2D.Viewers.makeRenderScreenShot();

                data.preview = preview ? preview.split(',')[1] : '';
                const zip = new JSZip();
                zip.file("content.json", JSON.stringify(data));
                return zip.generateAsync({type:"blob",  compression: "DEFLATE", compressionOptions: {level: 9}}).then(function(blob) {
                    return new Promise((resolve, _) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.readAsDataURL(blob);
                    });
                });
            }
            function selectedRender(renderData) {
                //let frameData = R2D.Viewers.getRenderFrameData();
                let frameData = {
                    screenWidth:R2D.Viewers.getSize().width,
                    screenHeight:R2D.Viewers.getSize().height,
                    frameWidth:R2D.Viewers.getSize().width,
                    frameHeight:R2D.Viewers.getSize().height,
                    ratioWidth:16,
                    ratioHeight:9
                }
                let cameraData = R2D.Viewers.getCameraData();
                fillAnsZipProjectData().then((zipData) => {
                    let data = JSON.stringify({
                        format: renderData.format,
                        exportType: renderData.type,
                        renderData: {
                            environment: renderData.environment
                        },
                        projectData: zipData,
                        frameData: frameData,
                        cameraData: cameraData
                    });

                    uploadRenderData(data);
                });
            }

            selectedRender(renderObj);

        })
    };

    me.checkExport = function(currentTask)
    {
        return new Promise((resolve, reject) => {

            let params = '';

            let urlFull = R2D.makeURL(R2D.URL.DOMAIN, '/api2/exporter/status/' + currentTask);
            let loader = new R2D.XHRLoader();

            loader.addEventListener(Event.COMPLETE, loaderEventHandler);
            loader.addEventListener(Event.ERROR, loaderEventHandler);
            loader.load(urlFull, params, 'GET', null, null, true, true);

            async function loaderEventHandler(event) {
                let loader = event.currentTarget;

                loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                loader.removeEventListener(Event.ERROR, loaderEventHandler);
                loader.close();

                if ( event.type == Event.COMPLETE ) {
                    let checkedData = checkForErrors(event.data.data);
                    if (checkedData)
                    {
                        resolve(checkedData);
                    }
                } else {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
            }

            function checkForErrors(data) {
                let object = null;

                try {
                    object = JSON.parse(data);
                    
                } catch ( error ) {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                    return;
                }

                if ( !object.hasOwnProperty('status'))
                {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
                else if ( object['status'] == 'error' )
                {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
                // else if ( !object.hasOwnProperty('data') )
                // {
                //     resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                // }
                else
                {
                    return object;
                }
            }
        })
        
    };
}

R2D.UserCore.UserPromo = function(user)
{
    let me = this;
    let loader = null;

    me.close = () => {
        if ( !loader ) return;

        loader.close();
        loader = null;
    }

    me.load = value => {
        return new Promise((resolve, reject) => {
            if ( loader ) return;
            let urlFull = R2D.makeURL(R2D.URL.DOMAIN, `/api/user/promo?name=${value}`);
            loader = R2D.XHRLoader.getPostLoader(urlFull, null, null, null, true);

            loader.addEventListener(Event.COMPLETE, loaderEventHandler);
            loader.addEventListener(Event.ERROR, loaderEventHandler);
            
            function loaderEventHandler(event) {
                if ( event.type == Event.COMPLETE ) {
                    checkData(event.data.data)
                } else {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
        
                close();
            }
            function checkData(data) {
                let object = null;
        
                try {
                    object = JSON.parse(data);
                } catch ( error ) {
                    resolve({type: "error", data: object['error'] || "TEXT_ERROR_LOAD_DATA"});
                    return false;
                }
        
                if ( !object.hasOwnProperty('status') ) {
                    resolve({type: "error", data: object['error'] || "TEXT_ERROR_LOAD_DATA"});
                    return;
                }
                if ( object['status'] == 'error' ) {
                    resolve({type: "error", data: object['error'] || "TEXT_ERROR_LOAD_DATA"});
                    return;
                }
                resolve(object);
        
            }
            function close() {
                if ( !loader ) return;
        
                loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                loader.removeEventListener(Event.ERROR, loaderEventHandler);
                loader.close();
                loader = null;
            }
        })
    };
};

R2D.UserCore.UserSubscription = function(user)
{
    let me = this;
    let loader = null;

    me.cancelSubscription = () => {
        return new Promise(async (resolve, reject) => {
            if ( loader ) return;
            var url = R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_CANCEL_SUBSCRIPTION);
            loader = new R2D.XHRLoader();
            loader.addEventListener(Event.COMPLETE, loaderEventHandler);
            loader.addEventListener(Event.ERROR, loaderEventHandler);
            loader.load(url, null, 'get', null, null, true);
            
            function loaderEventHandler(event) {
                if ( event.type == Event.COMPLETE ) {
                    checkData(event.data.data)
                } else {
                    resolve({type: "error", message: "error_load", data: "TEXT_ACTION_ERROR"});
                }
        
                close();
            }
            function checkData(data) {
                let object = null;
        
                try {
                    object = JSON.parse(data);
                } catch ( error ) {
                    console.error("Error parse JSON string!");
                    resolve({type: "error", message: "error_load", data: "TEXT_ACTION_ERROR"});
                    return false;
                }
        
                if ( !object.hasOwnProperty('status') || object['status'] != 'success' ) {
                    console.error("Status is not success!")
                    resolve({type: "error", message: "error_load", data: "TEXT_ACTION_ERROR"});
                    return;
                }
                resolve(object);
            }
            function close() {
                if ( !loader ) return;
        
                loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                loader.removeEventListener(Event.ERROR, loaderEventHandler);
                loader.close();
                loader = null;
            }
        })
    };

};
R2D.UserCore.UserSearch = function(user)
{
    let me = this;
    let loader = null;

    me.getSearchResult = function(searchQuery)
    {
        return new Promise((resolve, reject) => {
            
            let apiGetSearchResult = R2D.URL.URL_CATALOG_SEARCH + `&query=${searchQuery}`;

            let url = R2D.makeURL(R2D.URL.DOMAIN, apiGetSearchResult);
            
            loader = new R2D.XHRLoader();
            
            loader.addEventListener(Event.COMPLETE, loaderEventHandler);
            loader.addEventListener(Event.ERROR, loaderEventHandler);

            loader.load(url, null, 'get', null, null, true);

            async function loaderEventHandler(event)
            {
                loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                loader.removeEventListener(Event.ERROR, loaderEventHandler);
                loader.close();

                if ( event.type == Event.COMPLETE ) {
                    let data = event.data.data;
                    let object = null;
        
                    try {
                        object = JSON.parse(data);
                    } catch ( error ) {
                        console.error("Error parse JSON string!");
                    }
        
                    if ( object && object['status'] != 'ok' ) {
                        resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                    }

                    resolve(object);
                }
            }
        });
    };
};
R2D.UserCore.UserFavorites = function(user)
{
    let me = this;
    let loader = null;

    me.getList = function()
    {
        return new Promise((resolve, reject) => {

            let url = R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_FAVORITES_GET);
            
            loader = new R2D.XHRLoader();
            
            loader.addEventListener(Event.COMPLETE, loaderEventHandler);
            loader.addEventListener(Event.ERROR, loaderEventHandler);

            loader.load(url, null, 'get', null, null, true);

            async function loaderEventHandler(event)
            {
                loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                loader.removeEventListener(Event.ERROR, loaderEventHandler);
                loader.close();

                if ( event.type == Event.COMPLETE ) {
                    let data = event.data.data;
                    let object = null;
        
                    try {
                        object = JSON.parse(data);
                    } catch ( error ) {
                        console.error("Error parse JSON string!");
                    }
        
                    if ( object && object['status'] != 'ok' ) {
                        resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                    }
                    
                    object.data.items = object.data.items.filter(i => i);

                    resolve(object);
                }
            }
        });
    };

    me.addToFavorites = function(id, color)
    {
        return new Promise((resolve, reject) => {

            let apiAddToFavorites = R2D.URL.URL_FAVORITES_ADD.replace('{id}', id);

            let params = color ? JSON.stringify({
                add_data: color
            }) : null;

            let url = R2D.makeURL(R2D.URL.DOMAIN, apiAddToFavorites);
            loader = new R2D.XHRLoader();

            loader.addEventListener(Event.COMPLETE, loaderEventHandler);
            loader.addEventListener(Event.ERROR, loaderEventHandler);

            loader.load(url, params, 'put', null, null, true);

            async function loaderEventHandler(event)
            {
                loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                loader.removeEventListener(Event.ERROR, loaderEventHandler);
                loader.close();

                if ( event.type == Event.COMPLETE ) {
                    let data = event.data.data;
                    let object = null;
        
                    try {
                        object = JSON.parse(data);
                    } catch ( error ) {
                        console.error("Error parse JSON string!");
                    }
        
                    if ( object && object['status'] != 'ok' ) {
                        resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                    }
                    
                    if(user.data.favorites) {    
                        ++user.data.favorites.total;
                        user.data.favorites.items.push(object.data);
                    }
                    
                    resolve(object.data);
                }
            }

        });
    };

    me.removeFromFavorites = function(id, color = "")
    {
        return new Promise((resolve, reject) => {

            let apiRemoveFromFavorites = R2D.URL.URL_FAVORITES_DELETE.replace('{id}', id);

            let params = color ? JSON.stringify({
                add_data: color
            }) : null;

            let url = R2D.makeURL(R2D.URL.DOMAIN, apiRemoveFromFavorites);
            loader = new R2D.XHRLoader();

            loader.addEventListener(Event.COMPLETE, loaderEventHandler);
            loader.addEventListener(Event.ERROR, loaderEventHandler);

            loader.load(url, params, 'DELETE', null, null, true);

            async function loaderEventHandler(event)
            {
                loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                loader.removeEventListener(Event.ERROR, loaderEventHandler);
                loader.close();

                if ( event.type == Event.COMPLETE ) {
                    let data = event.data.data;
                    let object = null;
        
                    try {
                        object = JSON.parse(data);
                    } catch ( error ) {
                        console.error("Error parse JSON string!");
                    }
        
                    if ( object && object['status'] != 'ok' ) {
                        resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                    }
                    if(user.data.favorites) {
                        --user.data.favorites.total;
                        user.data.favorites.items = user.data.favorites.items.filter(i => i?.id != id || (i?.addData || "") != color);
                    }
                    resolve(object.data);
                }
            }
        });
    };
};
R2D.UserCore.UserLogin = function(user)
{
    let me = this;
    let loader = null;

    me.tryLogin = function(l, p)
    {
        return new Promise((resolve, reject) => {
            user.clearUserData();

            let params = JSON.stringify({login:l, password:p});

            loader = R2D.XHRLoader.getPostLoader(R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_USER_LOGIN), params, null, null, true);

            loader.addEventListener(Event.COMPLETE, loginEventHandler);
            loader.addEventListener(Event.ERROR, loginEventHandler);

            async function loginEventHandler(event) {
                let loader = event.currentTarget;

                loader.removeEventListener(Event.COMPLETE, loginEventHandler);
                loader.removeEventListener(Event.ERROR, loginEventHandler);
                loader.close();

                if ( event.type == Event.COMPLETE ) {
                    let loginRes = parseLoginData(event.data.data);
                    if (loginRes)
                    {
                        user.saveToken(loginRes.token);
                        let favorites = await user.uGetFavorites();
                        if(favorites.type == 'error') console.error(favorites.data);
                        else loginRes.favorites = favorites.data;
                        user.setUserData(loginRes);

                        // GTM
                        window.dataLayer?.push({'user_id': loginRes.id});
                        R2D.isLoggedStatus = "logged";
                        resolve({logged: true});
                    }
                } else {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
            }

            function parseLoginData(data) {
                let object = null;

                try {
                    object = JSON.parse(data);
                    
                } catch ( error ) {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                    return;
                }

                if ( !object.hasOwnProperty('status'))
                {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
                else if ( object['status'] == 'error' )
                {
                    console.error(object);

                    if (object.error == 'inactive_user') {

                        let url = R2D.makeURL(R2D.URL.DOMAIN, object.data.url);

                        let loader = new R2D.XHRLoader();

                        loader.addEventListener(Event.COMPLETE, loaderActivateListener);
                        loader.addEventListener(Event.ERROR, loaderActivateListener);
                        loader.load(url, null, 'GET', null, null, true);

                        function loaderActivateListener(e)
                        {
                            e.currentTarget.removeEventListener(Event.COMPLETE, loaderActivateListener);
                            e.currentTarget.removeEventListener(Event.ERROR, loaderActivateListener);

                            if (e.type == Event.COMPLETE )
                            {
                                resolve({type: "error", data: "TEXT_REGISTRATION_ACTIVATE"});
                            }
                            else
                            {
                                console.log('Error activating user');
                            }
                        }
                    }
                    else if( object['error'] && 
                        (
                            ( object['error']['login'] && object['error']['login'][0] == 'ERROR_TOO_MANY_ATTEMPTS' ) || 
                            ( object['error']['ip'] && object['error']['ip'][0] == 'ERROR_TOO_MANY_ATTEMPTS' )
                        )
                    ) {
                        resolve({type: "error", message: "error_too_many_attempts", data: "TEXT_AUTH_ERROR_TOO_MANY_ATTEMPTS"});
                    }
                    else
                    {
                        resolve({type: "error", data: "TEXT_SIGN_IN_INVALID_EMAIL_OR_PASSWORD"});
                    }
                }
                else if ( !object.hasOwnProperty('data') )
                {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
                else
                {
                    return object['data'];
                }
            }
        })
        
    };

    me.checkIsLogged = function(token)
    {
        return new Promise((resolve, reject) => {
            R2D.isLoggedStatus = "loggingIn";
            let params = '';

            let url = R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_USER_INFO);
            let loader = new R2D.XHRLoader();

            loader.addEventListener(Event.COMPLETE, loaderEventHandler);
            loader.addEventListener(Event.ERROR, loaderEventHandler);
            loader.load(url, params, 'GET', null, null, true, true, token);

            async function loaderEventHandler(event)
            {
                loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                loader.removeEventListener(Event.ERROR, loaderEventHandler);
                loader.close();

                if ( event.type == Event.COMPLETE ) {
                    let data = event.data.data;
                    let object = null;
        
                    try {
                        object = JSON.parse(data);
                    } catch ( error ) {
                        console.error("Error parse JSON string!");
                        token && R2D.tokensLoadedWithError.push(token);
                    }
        
                    if ( !object || (object?.hasOwnProperty('error') && object['error'] != 'access_denied') ) {
                        token && R2D.tokensLoadedWithError.push(token);
                        resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                    }
                    else if ( (object?.hasOwnProperty('error') && object['error'] == 'access_denied') || object?.hasOwnProperty('status') && object['status'] != 'ok' && object['status'] != 'success' ) {
                        R2D.isLoggedStatus = "unlogged";
                        token && R2D.tokensLoadedWithError.push(token);
                        resolve({logged: false});
                    }
                    
                    else if ( !checkUserData(object.data) ) {
                        token && R2D.tokensLoadedWithError.push(token);
                        resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                    }
                    else {
                        let favorites = await user.uGetFavorites();
                        if(favorites.type == 'error') console.error(favorites.data);
                        else object.data.favorites = favorites.data;
                        R2D.isLoggedStatus = "logged";
                        user.setUserData(object.data);
                        if(token) R2D.token = token;
                        resolve({logged: true});
                    }   
                }
            }

            function checkUserData(data) {
                
                if ( !data.hasOwnProperty('id') ) {
                    console.error("Error! Received data has no property \"id\"!");
                    console.log(data);
                    return false;
                }
                if ( !data.hasOwnProperty('email') ) {
                    console.error("Error! Received data has no property \"email\"!");
                    console.log(data);
                    return false;
                }
                if ( !data.hasOwnProperty('name') ) {
                    console.error("Error! Received data has no property \"name\"!");
                    console.log(data);
                    return false;
                }
                if ( !data.hasOwnProperty('key') ) {
                    console.error("Error! Received data has no property \"key\"!");
                    console.log(data);
                    return false;
                }
                return true;
            };
        });
    };

    me.logout = function()
    {
        return new Promise((resolve, reject) => {
            let url = R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_SIGN_OUT);
            let loader = new R2D.XHRLoader();

            loader.addEventListener(Event.COMPLETE, logoutEventHandler);
            loader.addEventListener(Event.ERROR, logoutEventHandler);
            loader.load(url, null, 'GET', null, null, true);

            function logoutEventHandler(event)
            {
                let loader = event.currentTarget;

                loader.removeEventListener(Event.COMPLETE, logoutEventHandler);
                loader.removeEventListener(Event.ERROR, logoutEventHandler);
                loader.close();

                if ( event.type == Event.COMPLETE ) {
                    let data = event.data.data;
                    let object = null;

                    try {
                        object = JSON.parse(data);
                    } catch ( error ) {
                        resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                    }

                    if (! object.hasOwnProperty('status') || object['status'] != 'success') {
                        resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                    }

                    user.clearUserData();
                    R2D.isLoggedStatus = "unlogged";
                    resolve({ logged: false });
                }
                else
                {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
            }
        }) 
        
    };

    me.setProfileData = function(data)
    {
        return new Promise((resolve, reject) => {
            
            let params = JSON.stringify(data);
    
            loader = R2D.XHRLoader.getPostLoader(R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_UPDATE_PROFILE), params, null, null, true);
    
            loader.addEventListener(Event.COMPLETE, loaderSetListener);
            loader.addEventListener(Event.ERROR, loaderSetListener);
    
            async function loaderSetListener(e) {
                loader.removeEventListener(Event.COMPLETE, loaderSetListener);
                loader.removeEventListener(Event.ERROR, loaderSetListener);

                resolve("success");
            }
        });
    };

    me.loadProfileData = () => {
        return new Promise(async (resolve, reject) => {
            
            let params = '';

            let url = R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_USER_INFO);
            
            let loader = new R2D.XHRLoader();

            loader.addEventListener(Event.COMPLETE, loaderEventHandler);
            loader.addEventListener(Event.ERROR, loaderEventHandler);
            loader.load(url, params, 'GET', null, null, true);
            
            function loaderEventHandler(event) {
                if ( event.type == Event.COMPLETE ) {
                    checkData(event.data.data)
                } else {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
        
                close();
            }
            function checkData(data) {
                let object = null;
        
                try {
                    object = JSON.parse(data);
                } catch ( error ) {
                    console.log('Error parse JSON string!');
                }
        
                if ( !object || (object?.hasOwnProperty('error')) || (object?.hasOwnProperty('status') && object['status'] != 'success' && object['status'] != 'ok') ) {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                    return;
                }

                user.setUserData({...user.data, ...object.data});
        
                resolve(object.data);
        
            }
            function close() {
                if ( !loader ) return;
        
                loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                loader.removeEventListener(Event.ERROR, loaderEventHandler);
                loader.close();
                loader = null;
            }
        })
    }
};
R2D.UserCore.UserAccount = function(user)
{
    let me = this;
    me.delete = function()
    {
        return new Promise((resolve, reject) => {
            let url = R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_DELETE_ACCOUNT);
            let loader = new R2D.XHRLoader();

            loader.addEventListener(Event.COMPLETE, logoutEventHandler);
            loader.addEventListener(Event.ERROR, logoutEventHandler);
            loader.load(url, null, 'DELETE', null, null, true);

            function logoutEventHandler(event) {
                let loader = event.currentTarget;

                loader.removeEventListener(Event.COMPLETE, logoutEventHandler);
                loader.removeEventListener(Event.ERROR, logoutEventHandler);
                loader.close();

                if ( event.type == Event.COMPLETE ) {
                    let data = event.data.data;
                    let object = null;

                    try {
                        object = JSON.parse(data);
                    } catch ( error ) {
                        resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                    }

                    if (! object.hasOwnProperty('status') || (object['status'] != 'success' && object['status'] != 'ok')) {
                        resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                    }

                    resolve(true);
                }
                else {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
            }
        }) 
    };
};

R2D.UserCore.UserPano = function(user)
{
    let me = this;
    let loader = null;

    me.load = () => {
        return new Promise(async (resolve, reject) => {
            if ( loader ) return;
            
            var params = '';

            let url = R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_CATALOG_SEARCH + '&category_tag=skybox');
            
            //loader = R2D.XHRLoader.getPostLoader(url, params, null, null, true);
            loader = new R2D.XHRLoader();
            loader.load(url, null, 'get', null, null, true);

            loader.addEventListener(Event.COMPLETE, loaderEventHandler);
            loader.addEventListener(Event.ERROR, loaderEventHandler);
            
            function loaderEventHandler(event) {
                if ( event.type == Event.COMPLETE ) {
                    user.dispatchEvent(new Event(Event.UPDATE, me));
                    checkData(event.data.data)
                } else {
                    user.dispatchEvent(new Event(Event.ERROR, me));
                }
        
                close();
            }
            function checkData(data) {
                let object = null;
        
                try {
                    object = JSON.parse(data);
                } catch ( error ) {
                    reject({message: 'Error parse JSON string!', data: data})
                    return false;
                }
        
                if ( !object.hasOwnProperty('status') || object['status'] != 'ok' ) {
                    reject({message: 'Status is not success!', data: data});
                    return;
                }
         
                resolve(object.data.items);
        
            }
            function close() {
                if ( !loader ) return;
        
                loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                loader.removeEventListener(Event.ERROR, loaderEventHandler);
                loader.close();
                loader = null;
            }
        })
    };

};
R2D.UserCore.UserProjects = function(user)
{
    let me = this;
    let loader = null;

    me. load = (limit = 0, offset = 0) => {
        return new Promise(async (resolve, reject) => {
            if ( loader ) return;

            let url = R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_LOAD_ALL_PLANS + `&limit=${limit}&offset=${offset}`);
            
            loader = new R2D.XHRLoader();
            loader.load(url, null, 'GET', null, null, true);

            loader.addEventListener(Event.COMPLETE, loaderEventHandler);
            loader.addEventListener(Event.ERROR, loaderEventHandler);
            
            function loaderEventHandler(event) {
                if ( event.type == Event.COMPLETE ) {
                    checkData(event.data.data)
                } else {
                    resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                }
        
                close();
            }
            function checkData(data) {
                let object = null;
        
                try {
                    object = JSON.parse(data);
                } catch ( error ) {
                    console.error('Error parse JSON string!')
                    return false;
                }
        
                if ( !object.hasOwnProperty('status') || object['status'] != 'ok' ) {
                    resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                    return;
                }
         
                resolve(object);
        
            }
            function close() {
                if ( !loader ) return;
        
                loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                loader.removeEventListener(Event.ERROR, loaderEventHandler);
                loader.close();
                loader = null;
            }
        })
    };

    me.openProject = id => {
        R2D.controller.clearCurrentScene();
        R2D.controller.loadScene(id);
    }

    me.deleteProject = id => {
        return new Promise((resolve, rej) => {
            let sceneDeleter = new R2D.SceneDelete(id);

            sceneDeleter.addEventListener(Event.COMPLETE, sceneDeleterEventHandler);
            sceneDeleter.addEventListener(Event.ERROR, sceneDeleterEventHandler);
            sceneDeleter.execute();

            function sceneDeleterEventHandler(event) {

                sceneDeleter.removeEventListener(Event.COMPLETE, sceneDeleterEventHandler);
                sceneDeleter.removeEventListener(Event.ERROR, sceneDeleterEventHandler);
                sceneDeleter.dispose();

                if ( event.type == Event.COMPLETE ) {
                    if ( R2D.controller.getProjectId() == id ) R2D.controller.createNewScene(true);
                    resolve();
                }
            }
        })
    }

    me.copyProject = project => {
        return new Promise((resolve, rej) => {
            var planId = project.id;
            var planName = project.name;
            var planNameNew = project.newName;
            
            var sceneCopier = new R2D.SceneCopy(planId, planName, planNameNew);
            sceneCopier.addEventListener(Event.COMPLETE, sceneCopierEventHandler);
            sceneCopier.addEventListener(Event.ERROR, sceneCopierEventHandler);
            sceneCopier.execute();
        
            function sceneCopierEventHandler(event) {
                let copiedProjectId = sceneCopier.getNewId();
                let copiedProjectHash = sceneCopier.getNewHash();
                sceneCopier.removeEventListener(Event.COMPLETE, sceneCopierEventHandler);
                sceneCopier.removeEventListener(Event.ERROR, sceneCopierEventHandler);
                sceneCopier.dispose();
                resolve({id: copiedProjectId, hash: copiedProjectHash});
            }
        })
    };

    me.projectHashLoad = projectId => {
        return new Promise((resolve, rej) => {
            if ( projectId == 0 ) {
                resolve({type: "error", message: "not_saved_project", data: "TEXT_SAVE_BEFORE_SHARE_PLAN"})
                return;
            }
            var url = R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_SHARE_PLAN);
            var params = R2D.XHRLoader.makeParamsString({
                json:JSON.stringify({
                    plan_id:projectId
                })
            });
            var loader = R2D.XHRLoader.getPostLoader(url, params, null, null, true);
            
            function parseReceivedData(object) {
                if ( !object.hasOwnProperty('status') ) {
                    console.error("Received data has no property \"status\"");
                    console.log(object);
                    resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"})
                    return;
                }
                if ( object['status'] == 'error' ) {
                    console.error("Received data status error!");
                    console.log(object);
                    resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"})
                    return;
                }
                if ( object['status'] != 'success' ) {
                    console.error("Received data has unknown status!");
                    console.log(object);
                    resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"})
                    return;
                }
                if ( !object.hasOwnProperty('hash') ) {
                    console.error("Received data has no property \"hash\"");
                    console.log(object);
                    resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"})
                    return;
                }

                resolve(object['hash'])
            }
        
            function loaderEventHandler(event) {
                if ( event.type == Event.COMPLETE ) {
                    var json = event.data.data;
                    var object = null;
        
                    try {
                        object = JSON.parse(json);
                    } catch ( error ) {
                        console.error("Error parse JSON!");
                        console.log(json);
                        resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"})
                    }
        
                    if ( object ) {
                        parseReceivedData(object);
                    }
                } else {
                    console.warn('Share project ' + projectId + ' error!');
                    console.log(event.data.data);
                }
        
                loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                loader.removeEventListener(Event.ERROR, loaderEventHandler);
                loader.close();
                loader = null;
            }
        
            loader.addEventListener(Event.COMPLETE, loaderEventHandler);
            loader.addEventListener(Event.ERROR, loaderEventHandler);
        })
    };
};

R2D.UserCore.UserRenders = function(user)
{
    let me = this;
    let loader = null;

    me.load = (limit = 20, offset = 0) => {
        return new Promise(async (resolve, reject) => {
            let url = R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_RENDER_ALL + `&limit=${limit}&offset=${offset}`);
            loader = new R2D.XHRLoader();
            loader.load(url, null, 'GET', null, null, true);

            loader.addEventListener(Event.COMPLETE, loaderEventHandler);
            loader.addEventListener(Event.ERROR, loaderEventHandler);
            
            function loaderEventHandler(event) {
                if ( event.type == Event.COMPLETE ) {
                    checkData(event.data.data)
                } else {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
        
                close();
            }
            function checkData(data) {
                let object = null;
        
                try {
                    object = JSON.parse(data);
                } catch ( error ) {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
        
                if ( !object.hasOwnProperty('status') || object['status'] != 'ok' ) {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
         
                resolve(object);
        
            }
            function close() {
                if ( !loader ) return;
        
                loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                loader.removeEventListener(Event.ERROR, loaderEventHandler);
                loader.close();
                loader = null;
            }
        })
    };

    me.deleteRender = renderId => {
        return new Promise(async (resolve, reject) => {
            function loaderHandler(event) {
                resolve(event);
            };
            
            let url = `${R2D.URL.DOMAIN}${R2D.URL.URL_RENDER_DELETE}`.replace("{id}", renderId);

            let loader = new R2D.XHRLoader();

            loader.addEventListener(Event.COMPLETE, loaderHandler);
            loader.addEventListener(Event.ERROR, loaderHandler);
            loader.load(url, null, 'DELETE', null, 'json', true);
        })
    };

    me.openRender = renderId => {
        return new Promise((resolve, reject) => {

            let url = `${R2D.URL.DOMAIN}${R2D.URL.URL_RENDER_GET}`.replace("{id}", renderId);

            let loader = new R2D.XHRLoader();

            function eventHandler(event) {

                if ( event.type == Event.ERROR ) {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }

                let json = event.data.data;
                let object = null;

                try { object = JSON.parse(json) }
                catch ( error ) {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }

                if ( !object.status || object.status != 'ok' ) {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
                resolve(object.data);
            }
            loader.addEventListener(Event.COMPLETE, eventHandler);
            loader.addEventListener(Event.ERROR, eventHandler);
            loader.load(url, null, 'GET', null, null, true);
        })
    };

    me.reloadRender = renderId => {
        return new Promise((resolve, reject) => {

            let url = `${R2D.URL.DOMAIN}${R2D.URL.URL_RENDER_RELOAD}`.replace("{id}", renderId);

            let loader = new R2D.XHRLoader();

            function eventHandler(event) {

                if ( event.type == Event.ERROR ) resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                let object = event.data.data;

                if ( object.status == "error" && object.error == "render can't be restarted") resolve({type: "error", data: "RENDER_ERROR_CANT_RELOAD"});
                if ( !object.status || object.status != 'ok' ) resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});

                resolve(object);
            }

            loader.addEventListener(Event.COMPLETE, eventHandler);
            loader.addEventListener(Event.ERROR, eventHandler);
            loader.load(url, null, 'PUT', null, 'json', true);
        })
        
    }

    me.showRenderFrame = () => R2D.Viewers.showRenderFrame();

    me.hideRenderFrame = () => R2D.Viewers.hideRenderFrame();

    me.makeRender = renderObj => {
        return new Promise((resolve, reject) => {
            function handleRenderError(data) {
                if ( !data || !data.status || data.status !== 'error' ) {
                    return resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
                if ( data?.error === 'not_enough_credits' || data?.error === 'not enough credits' ) {
                    return resolve({type: "error", data: "TEXT_RENDERS_NOT_CREDITS"});
                }
        
                handleRenderError(null);
            }
            function uploadActionHandler(event) {
                if ( event.type === Event.ERROR ) {
                    return resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
                if ( !event.currentTarget.data ) {
                    return resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
                if ( !event.currentTarget.data.status ) {
                    return resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
                if ( event.currentTarget.data.status !== 'ok' ) {
                    return handleRenderError(event.currentTarget.data);
                }
                resolve(event.currentTarget.data.data.renderId);
            }
            function uploadRenderData(data) {
                let loader = new R2D.XHRLoader();
                let headers = [{header: "Content-Type", value: 'application/json'}];

                let url = R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_RENDER_NEW);

                loader.load(url, data, "POST", headers, 'json', true);
        
                loader.addEventListener(Event.COMPLETE, uploadActionHandler);
                loader.addEventListener(Event.ERROR, uploadActionHandler);
            }

            async function fillAnsZipProjectData () {
                let data = R2D.controller.scene.getSceneState(true);

                data.scene.products = data.scene.products.filter(i => i.visible);

                // if (renderObj.type != 5) {
                //     const productsInFrustum =
                //         R2D.commonSceneHelper.productHelper.getProductsInFrustum(
                //             data.scene.products
                //         );
                //     data.scene.products = productsInFrustum;
                // }

                data.scene.products.forEach(product => {
                    if (product.isParametric) {
                        product.sx = 1;
                        product.sy = 1;
                        product.sz = 1;
                    }
                });

                const url = await R2D.commonSceneHelper.productHelper.exportZipSendModels();
                data.scene.modelsZipSrc = url;

                data.construction.covers = data.construction.covers.map(i => {
                    i.cv = i.cvisible ? 1 : 0;
                    return i;
                });

                let preview = R2D.Viewers.makeRenderScreenShot();

                data.preview = preview.split(',')[1];
                const zip = new JSZip();
                zip.file("content.json", JSON.stringify(data));
                return zip.generateAsync({type:"blob",  compression: "DEFLATE", compressionOptions: {level: 9}}).then(function(blob) {
                    return new Promise((resolve, _) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.readAsDataURL(blob);
                    });
                });
            }
            function selectedRender(renderData) {
                //let frameData = R2D.Viewers.getRenderFrameData();
                let frameData = {
                    screenWidth:R2D.Viewers.getSize().width,
                    screenHeight:R2D.Viewers.getSize().height,
                    frameWidth:R2D.Viewers.getSize().width,
                    frameHeight:R2D.Viewers.getSize().height
                }
                let cameraData = R2D.Viewers.getCameraData();
                fillAnsZipProjectData().then((zipData) => {
                    let data = JSON.stringify({
                        renderType: renderData.type,
                        renderView: R2D.Viewers.getCurrentViewerType() == "walk" ? 'interior' : R2D.view3d.getRenderMakeType() == 'topView' ? 'top' : 'exterior',
                        renderOrientation: R2D.Viewers.getRenderScreenType(),
                        renderData: {
                            environment: renderData.environment
                        },
                        projectData: zipData,
                        frameData: frameData,
                        cameraData: cameraData
                    });

                    uploadRenderData(data);
                });
            }
        
            selectedRender(renderObj);

        })
        
        
    };
};

R2D.UserCore.UserTranslation = function(user)
{
    let me = this;
    let loader = null;

    me.load = () => {
        return new Promise(async (resolve, reject) => {
            if ( loader ) return;
            
            var params = '';

            let url = R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_TRANSLATION);
            
            loader = R2D.XHRLoader.getPostLoader(url, params, null, null, true);

            loader.addEventListener(Event.COMPLETE, loaderEventHandler);
            loader.addEventListener(Event.ERROR, loaderEventHandler);
            
            function loaderEventHandler(event) {
                if ( event.type == Event.COMPLETE ) {
                    user.dispatchEvent(new Event(Event.UPDATE, me));
                    checkData(event.data.data)
                } else {
                    user.dispatchEvent(new Event(Event.ERROR, me));
                }
        
                close();
            }
            function checkData(data) {
                let object = null;
                let dataList = {};
        
                try {
                    object = JSON.parse(data);
                } catch ( error ) {
                    reject({message: 'Error parse JSON string!', data: data})
                    return false;
                }
        
                if ( !object.hasOwnProperty('status') || object['status'] != 'success' ) {
                    reject({message: 'Status is not success!', data: data});
                    return;
                }
        
                if ( !object.hasOwnProperty('result') ) {
                    reject({message: 'Received data has no property "result"!', data: data});
                    return;
                }
        
                for ( let i = 0, l = object['result'].length; i < l; i++ ) {
                    let item = object['result'][i];
                    let key = null;
                    let value = null;
        
                    if ( !item.hasOwnProperty('code') ) {
                        console.warn('Translation item has no property "code"!');
                        console.log(item);
                        continue;
                    }
                    if ( !item.hasOwnProperty('value') ) {
                        console.warn('Translation item has no property "value"!');
                        console.log(item);
                        continue;
                    }
        
                    key = item['code'];
                    value = item['value'];
        
                    dataList[key] = value;
                }
                resolve(dataList);
        
            }
            function close() {
                if ( !loader ) return;
        
                loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                loader.removeEventListener(Event.ERROR, loaderEventHandler);
                loader.close();
                loader = null;
            }
        })
    };

};

R2D.UserCore.UserTours360 = function(user)
{
    let me = this;
    let loader = null;

    me.getTours = function()
    {
        return new Promise((resolve, reject) => {
            let params = JSON.stringify({
                t:R2D.token,
                a: 'get_tours_list',
                lang: user.languages.find(i => i["current"] == 1).code
            });

            loader = R2D.XHRLoader.getPostLoader(R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_360_TOURS_GET), params, null, null, true);

            loader.addEventListener(Event.COMPLETE, loginEventHandler);
            loader.addEventListener(Event.ERROR, loginEventHandler);

            async function loginEventHandler(event) {
                let loader = event.currentTarget;

                loader.removeEventListener(Event.COMPLETE, loginEventHandler);
                loader.removeEventListener(Event.ERROR, loginEventHandler);
                loader.close();

                if ( event.type == Event.COMPLETE ) {
                    let parsedData = parseData(event.data.data);
                    resolve(parsedData || []);
                } else {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
            }

            function parseData(data) {
                let object = null;

                try {
                    object = JSON.parse(data);
                    
                } catch ( error ) {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                    return;
                }

                if ( !object.hasOwnProperty('status'))
                {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
                else if ( object['status'] == 'error' )
                {
                    console.error(object);
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                    
                }
                else
                {
                    return object['data'] || [];
                }
            }
        })
    };

    me.deleteTour = function(url)
    {
        return new Promise((resolve, reject) => {
            let params = null;
            let loader = new R2D.XHRLoader();

            loader.addEventListener(Event.COMPLETE, loginEventHandler);
            loader.addEventListener(Event.ERROR, loginEventHandler);

            let fullUrl = R2D.makeURL(R2D.URL.DOMAIN, '/api2' + url);

            loader.load(fullUrl, params, 'DELETE', null, null, true);

            async function loginEventHandler(event) {
                let loader = event.currentTarget;

                loader.removeEventListener(Event.COMPLETE, loginEventHandler);
                loader.removeEventListener(Event.ERROR, loginEventHandler);
                loader.close();

                if ( event.type == Event.COMPLETE ) {
                    let parsedData = parseData(event.data.data);
                    resolve(parsedData);
                } else {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
            }

            function parseData(data) {
                let object = null;

                try {
                    object = JSON.parse(data);
                    
                } catch ( error ) {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                    return;
                }

                if ( !object.hasOwnProperty('status'))
                {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
                else if ( object['status'] != 'ok' )
                {
                    console.error(object);
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                    
                }
                else
                {
                    return object['status'];
                }
            }
        })
        
    };
};
R2D.UserCore.UserLanguage = function(user)
{
    let me = this;

    me.load = async () => {
        return new Promise(async (resolve, reject) => {
            let url = R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_LANGUAGE_LIST);
            let params = '';

            let loader = R2D.XHRLoader.getPostLoader(url, params, null, null, true);

            loader.addEventListener(Event.COMPLETE, loaderEventHandler);
            loader.addEventListener(Event.ERROR, loaderEventHandler);

            function loaderEventHandler(event)
            {
                loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                loader.removeEventListener(Event.ERROR, loaderEventHandler);
                loader.close();

                if ( event.type == Event.COMPLETE ) {
                    parseData(event.data.data);
                } else {
                    reject({message: 'Request error', data: event});
                }
            }

            function parseData(data) {
                let object = null;
                try {
                    object = JSON.parse(data);
                } catch ( error ) {
                    reject({message: 'Error parse JSON string!', data: data});
                    return;
                }

                if ( !object.hasOwnProperty('status') || object['status'] != 'success' ) {
                    reject({message: 'Status is not success!', data: data});
                    return;
                }

                if ( !object.hasOwnProperty('result') ) {
                    reject({message: 'Received data has no property "result"!', data: data});
                    return;
                }

                let languages = object['result'];

                let langCode = loadLanguage();

                if(langCode) {
                    for (let i = 0; i < languages.length; i++) {
                        if (languages[i].code == langCode)
                        {
                            languages[i].current = 1;
                        }
                        else
                        {
                            languages[i].current = 0;
                        }
                    }
                }
                else {
                    let active = languages.find(i => i["current"] == 1);
                    if(!active) {
                        languages.forEach(i => {
                            if(i["default"] == 1) i["current"] = 1;
                        });
                    }
                }
                user.dispatchEvent(new Event(user.LANGUAGE_UPDATE, {}));
                user.languages = languages;
                resolve(languages);
            }
        });

    };

    me.setCurrentCode = (languages, code) =>
    {
        return new Promise(async (resolve, reject) => {

            let langData = null;
            for (let d of languages)
            {
                if (d.code == code) langData = d;
            }
            if (! langData)
            {
                return;
            }

            saveLanguage(code);

            let url = R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_SET_LANGUAGE);
            let params = 'json='+JSON.stringify({
                    lang_id: langData['id'],
                    lang: langData['code']
                });

            let loader = R2D.XHRLoader.getPostLoader(url, params, null, null, true);
            loader.addEventListener(Event.COMPLETE, loaderEventHandler);
            loader.addEventListener(Event.ERROR, loaderEventHandler);

            function loaderEventHandler(event) {
                loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                loader.removeEventListener(Event.ERROR, loaderEventHandler);
                loader.close();

                if ( event.type == Event.COMPLETE ) {
                    checkReceivedData(event.data.data);
                } else {
                }
            }

            async function checkReceivedData(data) {
                let object = null;

                try {
                    object = JSON.parse(data);
                } catch ( error ) {
                    return;
                }

                if ( !object.hasOwnProperty('status') || object['status'] != 'success') {
                    return;
                }

                let languages = await me.load();
                user.languages = languages;
                resolve(languages);
            }
        })
        
    };

    function saveLanguage(code)
    {
        R2D.language = code;
        R2D.Storage.save('r2d_lang', code);
    }

    function loadLanguage()
    {
        let langCode = R2D.language;

        if (!R2D.language)
        {
            langCode = R2D.Storage.load('r2d_lang');
            if (langCode) R2D.language = langCode;
        }

        return langCode;
    }

    loadLanguage();
};
R2D.UserCore.CameraViews = function(user)
{
    let me = this;
    let loader = null;

    me.load = projectId => {
        return new Promise(async (resolve, reject) => {
            if ( loader ) return;
            let url = `${R2D.URL.DOMAIN}${R2D.URL.URL_CAMERA_VIEWS}?plan_id=${projectId}`;
            loader = new R2D.XHRLoader();
            loader.load(url, null, 'GET', null, null, true);
            loader.addEventListener(Event.COMPLETE, loaderEventHandler);
            loader.addEventListener(Event.ERROR, loaderEventHandler);
            
            function loaderEventHandler(event) {
                if ( event.type == Event.COMPLETE ) {
                    checkData(event.data.data)
                } else {
                    resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                }
        
                close();
            }
            function checkData(data) {
                let object = null;
        
                try {
                    object = JSON.parse(data);
                } catch ( error ) {
                    console.error('Error parse JSON string!')
                    return false;
                }
        
                if ( !object.hasOwnProperty('status') ) {
                    console.error('Error! Received data has no property "status"!');
                    console.log(object);
                    return;
                }
                if ( object['status'] != 'ok' ) {
                    resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                }
         
                resolve(object?.data);
        
            }
            function close() {
                if ( !loader ) return;
        
                loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                loader.removeEventListener(Event.ERROR, loaderEventHandler);
                loader.close();
                loader = null;
            }
        })
    };

    me.save = data => {
        return new Promise(async (resolve, reject) => {
            if ( loader ) return;

            let params = JSON.stringify(data);
            
            loader = R2D.XHRLoader.getPostLoader(R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_CAMERA_VIEWS), params, null, null, true);

            loader.addEventListener(Event.COMPLETE, loaderEventHandler);
            loader.addEventListener(Event.ERROR, loaderEventHandler);
            
            function loaderEventHandler(event) {
                if ( event.type == Event.COMPLETE ) {
                    checkData(event.data.data)
                } else {
                    resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                }
        
                close();
            }
            function checkData(data) {
                let object = null;
        
                try {
                    object = JSON.parse(data);
                } catch ( error ) {
                    console.error('Error parse JSON string!')
                    return false;
                }
        
                if ( !object.hasOwnProperty('status') ) {
                    console.error('Error! Received data has no property "status"!');
                    console.log(object);
                    return;
                }
                if ( object['status'] != 'ok' ) {
                    resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                }
         
                resolve(object.data);
        
            }
            function close() {
                if ( !loader ) return;
        
                loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                loader.removeEventListener(Event.ERROR, loaderEventHandler);
                loader.close();
                loader = null;
            }
        })
    };

    me.delete = cameraViewId => {
        return new Promise(async (resolve, reject) => {
            if ( loader ) return;
            let url = `${R2D.URL.DOMAIN}${R2D.URL.URL_CAMERA_VIEWS}/${cameraViewId}`;
            loader = new R2D.XHRLoader();
            loader.load(url, null, 'DELETE', null, null, true);
            loader.addEventListener(Event.COMPLETE, loaderEventHandler);
            loader.addEventListener(Event.ERROR, loaderEventHandler);
            
            function loaderEventHandler(event) {
                if ( event.type == Event.COMPLETE ) {
                    checkData(event.data.data)
                } else {
                    resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                }
        
                close();
            }
            function checkData(data) {
                let object = null;
        
                try {
                    object = JSON.parse(data);
                } catch ( error ) {
                    console.error('Error parse JSON string!')
                    return false;
                }
        
                if ( !object.hasOwnProperty('status') ) {
                    console.error('Error! Received data has no property "status"!');
                    console.log(object);
                    return;
                }
                if ( object['status'] != 'ok' ) {
                    resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                }
         
                resolve(object.data);
        
            }
            function close() {
                if ( !loader ) return;
        
                loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                loader.removeEventListener(Event.ERROR, loaderEventHandler);
                loader.close();
                loader = null;
            }
        })
    };
};

R2D.UserCore.UserRegistration = function(user)
{
    var me = this;
    let loader = null;

    me.registration = data => {

        return new Promise((resolve, reject) => {
            
            //var params = R2D.XHRLoader.makeParamsString(data);
            let params = JSON.stringify(data);

            loader = R2D.XHRLoader.getPostLoader(R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_USER_REGISTER), params, null, null, true);

            loader.addEventListener(Event.COMPLETE, regCompleteListener);
            loader.addEventListener(Event.ERROR, regErrorListener);

            function regCompleteListener(e)
            {
                var dataObj;
                try {
                    dataObj = JSON.parse(e.data.data);
                } catch ( error ) {
                    console.error('Error parse JSON string!');
                    console.log(e.data.data);
                    return;
                }
                if ( !dataObj.hasOwnProperty('status') ) {
                    console.error('Error! Received data has no property "status"!');
                    console.log(dataObj);
                    return;
                }
                if ( dataObj['status'] != 'ok' ) {
                    console.error('Error! Received data status is not "ok"!');
                    console.log(dataObj);
                    if (dataObj['error'] && dataObj['error']['login'] && dataObj['error']['login'][0] == 'This email is already in use.')
                    {
                        resolve({type: "error", message: "error_email_used", data: "TEXT_REG_ERROR_EMAIL_USED"});
                    }
                    else if(dataObj['status'] == 'error' && dataObj['error'] && dataObj['error']['ip'] && dataObj['error']['ip'][0] == 'ERROR_TOO_MANY_ATTEMPTS') {
                        resolve({type: "error", message: "error_too_many_attempts", data: "TEXT_REG_ERROR_TOO_MANY_ATTEMPTS"});
                    }
                    else
                    {
                        resolve({type: "error", message: "error_performing", data: "TEXT_ACTION_ERROR"});
                    }

                    return;
                }
                // GTM
                window.dataLayer.push({'event': 'register'});

                resolve({type: "load_thanks"});
                R2D.controller.trySaveProjectToStorage();
            }

            function regErrorListener(e)
            {
                resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                console.log(e);
            }
        })

    };
};

R2D.UserCore.RightPanelData = function(user)
{
    let me = this;
    let loader = null;

    me.close = () => {
        if ( !loader ) return;

        loader.close();
        loader = null;
    }

    me.load = (url, country) => {
        return new Promise(async (resolve, reject) => {
            if ( loader ) return;
            let urlFull = R2D.makeURL(R2D.URL.DOMAIN, url);
            loader = R2D.XHRLoader.getPostLoader(urlFull, null, country ? [{
                header: "x-country",
                value: country
            }] : null, null, true);

            loader.addEventListener(Event.COMPLETE, loaderEventHandler);
            loader.addEventListener(Event.ERROR, loaderEventHandler);
            
            function loaderEventHandler(event) {
                if ( event.type == Event.COMPLETE ) {
                    checkData(event.data.data)
                } else {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
        
                close();
            }
            function checkData(data) {
                let object = null;
        
                try {
                    object = JSON.parse(data);
                } catch ( error ) {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                    return false;
                }
        
                if ( !object.hasOwnProperty('status') || object['status'] != 'success' ) {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                    return;
                }
                resolve(object);
        
            }
            function close() {
                if ( !loader ) return;
        
                loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                loader.removeEventListener(Event.ERROR, loaderEventHandler);
                loader.close();
                loader = null;
            }
        })
    };

    me.deleteMaterial = params => {
        return new Promise(async (resolve, reject) => {

            if ( loader ) return;

            let urlFull = R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_DELETE_PRIVATE);
            
            loader = R2D.XHRLoader.getPostLoader(urlFull, params, null, null, true);

            loader.addEventListener(Event.COMPLETE, loaderEventHandler);
            loader.addEventListener(Event.ERROR, loaderEventHandler);
            
            function loaderEventHandler(event) {
                if ( event.type == Event.COMPLETE ) {
                    user.dispatchEvent(new Event(Event.UPDATE, me));
                    checkData(event.data.data)
                } else {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
        
                close();
            }
            function checkData(data) {
                let object = null;
        
                try {
                    object = JSON.parse(data);
                } catch ( error ) {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                    return false;
                }
        
                if ( !object.hasOwnProperty('status') || object['status'] != 'success' ) {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                    return;
                }
                resolve(object);
        
            }
            function close() {
                if ( !loader ) return;
        
                loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                loader.removeEventListener(Event.ERROR, loaderEventHandler);
                loader.close();
                loader = null;
            }
        })
    };
};

R2D.UserCore.UserPassword = function(user)
{
    var me = this;
    let loader = null;

    me.changePassword = data => {

        return new Promise((resolve, reject) => {

            var params = JSON.stringify(data);

            loader = R2D.XHRLoader.getPostLoader(R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_CHANGE_PASSWORD), params, null, null, true);

            loader.addEventListener(Event.COMPLETE, regCompleteListener);
            loader.addEventListener(Event.ERROR, regErrorListener);

            function regCompleteListener(e) {
                var dataObj;
                try {
                    dataObj = JSON.parse(e.data.data);
                } catch ( error ) {
                    console.error('Error parse JSON string!');
                    console.log(e.data.data);
                    resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                }
                if ( !dataObj.hasOwnProperty('status') ) {
                    console.error('Error! Received data has no property "status"!');
                    console.log(dataObj);
                    return;
                }
                if( dataObj['error'] && dataObj['error']['old_password'] && dataObj['error']['old_password'][0] == 'Old password is incorrect' ) {
                    resolve({type: "error", message: "old_password_not_match", data: "OLD_PASSWORD_NOT_MATCH"});
                }
                if( dataObj['error'] && dataObj['error']['password'] && dataObj['error']['password'][0] == 'New password must be different from old password' ) {
                    resolve({type: "error", message: "old_password_equil_new", data: "ERROR_PASSWORD_NEW_EQUIL_OLD"});
                }
                if ( dataObj['status'] != 'success' && dataObj['status'] != 'ok' ) {
                    console.error('Error! Received data status is not "success"!');
                    resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});   
                }
                
                resolve({type: "update_pass_complete", data: "USER_ACCOUNT_RESET_P_SUCCESS_TEXT"});
            }

            function regErrorListener(e) {
                resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
            }
            
        })

    };

    me.recoveryPasswordRequest = data => {

        return new Promise((resolve, reject) => {

            var params = JSON.stringify(data);

            loader = R2D.XHRLoader.getPostLoader(R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_RECOVERY_PASSWORD_REQUEST), params, null, null, true);

            loader.addEventListener(Event.COMPLETE, regCompleteListener);
            loader.addEventListener(Event.ERROR, regErrorListener);

            function regCompleteListener(e) {
                var dataObj;
                try {
                    dataObj = JSON.parse(e.data.data);
                } catch ( error ) {
                    console.error('Error parse JSON string!');
                    console.log(e.data.data);
                    resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                }
                if ( !dataObj.hasOwnProperty('status') ) {
                    console.error('Error! Received data has no property "status"!');
                    console.log(dataObj);
                    return;
                }
                if( dataObj['error'] && dataObj['error']['email'][0] == 'User not found' ) {
                    resolve({type: "error", message: "user_not_found", data: "TEXT_RECOVER_NOT_FOUND"});
                }
                if ( dataObj['status'] != 'success' && dataObj['status'] != 'ok' ) {
                    if(dataObj['status'] == 'error' && dataObj['error'] && dataObj['error']['email'] && dataObj['error']['email'][0] == 'ERROR_TOO_MANY_ATTEMPTS') {
                        resolve({type: "error", message: "error_too_many_attempts", data: "TEXT_REC_PASS_ERROR_TOO_MANY_ATTEMPTS"});
                    } else {
                        console.error('Error! Received data status is not "success"!');
                        resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                    }
                }
                
                resolve({type: "recovery_request", data: "TEXT_RECOVER_PASS_SENT"});
            }

            function regErrorListener(e) {
                resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
            }
            
        })

    };

    me.recoveryPasswordConfirm = (data, token) => {

        return new Promise((resolve, reject) => {

            var params = JSON.stringify(data);

            let url = R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_RECOVERY_PASSWORD_CONFIRM.replace('{token}', token))

            let loader = new R2D.XHRLoader();

            loader.addEventListener(Event.COMPLETE, regCompleteListener);
            loader.addEventListener(Event.ERROR, regErrorListener);
            loader.load(url, params, 'PUT', null, null, true);

            loader.addEventListener(Event.COMPLETE, regCompleteListener);
            loader.addEventListener(Event.ERROR, regErrorListener);

            function regCompleteListener(e) {
                var dataObj;
                try {
                    dataObj = JSON.parse(e.data.data);
                } catch ( error ) {
                    console.error('Error parse JSON string!');
                    console.log(e.data.data);
                    resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                }
                if ( !dataObj.hasOwnProperty('status') ) {
                    console.error('Error! Received data has no property "status"!');
                    console.log(dataObj);
                    return;
                }
                if( dataObj['error'] && dataObj['error']['password'] && dataObj['error']['password'][0] == 'New password must be different from old password' ) {
                    resolve({type: "error", message: "old_password_equil_new", data: "ERROR_PASSWORD_NEW_EQUIL_OLD"});
                }
                if ( dataObj['status'] != 'success' && dataObj['status'] != 'ok' ) {
                    console.error('Error! Received data status is not "success"!');
                    resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                }
                
                resolve({type: "recovery_confirm", data: "USER_ACCOUNT_RESET_P_SUCCESS_TEXT"});
            }

            function regErrorListener(e) {
                resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
            }
            
        })

    };

};

R2D.UserCore.UserDimensions = function(user) {

    this.changeDimension = function(dimensionType) {
        switch ( dimensionType ) {
            case "cm":
                R2D.DimensionSystem.setSystem(R2D.DimensionSystem.METRIC_CM);
                break;
    
            case "ft":
                R2D.DimensionSystem.setSystem(R2D.DimensionSystem.IMPERIAL_FT);
                break;
    
            case "m":
                R2D.DimensionSystem.setSystem(R2D.DimensionSystem.METRIC_M);
                break;
    
            case "mm":
                R2D.DimensionSystem.setSystem(R2D.DimensionSystem.METRIC_MM);
                break;
        }
    };
}




R2D.UserCore.UserFacebook = function(user) {

    var fbApiInited = false;

    let me = this;

    me.facebookLogin = () => {
        return new Promise((resolve, reject) => {

            function loginStatus(response) {
                
                if ( response.status == "connected" ) {
                    console.log('loginStatus', response);
                    loginUserViaFb(response.authResponse.accessToken);
                } else {
                    console.warn('User cancelled login or did not fully authorize.');
                }
            }
    
            function loginUserViaFb(token) {
        
                async function loaderEventHandler(event) {
                    var loader = event.currentTarget;
            
                    loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                    loader.removeEventListener(Event.ERROR, loaderEventHandler);
                    loader.close();
                    loader = null;

                    if ( event.type == Event.COMPLETE ) {
                        let result = parseLoginData(event.data.data);
                        if(result) {
                            let favorites = await user.uGetFavorites();
                            if(favorites.type == 'error') console.error(favorites.data);
                            else result.favorites = favorites.data;

                            user.setUserData(result);
                            resolve({logged: true});
                        }
                    } else {
                        console.error("Error!");
                        resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                    }
                }
                function onResponse(userData) {
                    var data = {
                        login       : userData.email,
                        name        : userData.name,
                        token       : token,
                        social_net  : 1
                    };
                    var loader = R2D.XHRLoader.getPostLoader(R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_USER_LOGIN_SOCIAL), JSON.stringify(data), null, null, true);
            
                    loader.addEventListener(Event.COMPLETE, loaderEventHandler);
                    loader.addEventListener(Event.ERROR, loaderEventHandler);
                }
        
                function parseLoginData(data) {
                    var object = null;
        
                    try {
                        object = JSON.parse(data);
                        
                    } catch ( error ) {
                        resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                        return;
                    }
        
                    if ( !object.hasOwnProperty('status'))
                    {
                        resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                    }
                    else if ( object['status'] == 'error' )
                    {
                        console.error(object);
        
                        if (object.error == 'inactive_user' ) {
                            let url = R2D.makeURL(R2D.URL.DOMAIN, object.data.url);

                            let loader = new R2D.XHRLoader();

                            loader.addEventListener(Event.COMPLETE, loaderActivateListener);
                            loader.addEventListener(Event.ERROR, loaderActivateListener);
                            loader.load(url, null, 'GET', null, null, true);

                            function loaderActivateListener(e)
                            {
                                e.currentTarget.removeEventListener(Event.COMPLETE, loaderActivateListener);
                                e.currentTarget.removeEventListener(Event.ERROR, loaderActivateListener);

                                if (e.type == Event.COMPLETE )
                                {
                                    resolve({type: "error", message: "not_active_account", data: "TEXT_REGISTRATION_ACTIVATE"});
                                }
                                else
                                {
                                    resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                                }
                            }
                        }
                        else {
                            resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                        }
                    }
                    else
                    {
                        return object['data'];
                    }
                }
            
                FB.api('/me', {
                    fields: 'id, name, email'
                }, onResponse);
            }

            if(typeof FB == 'undefined' || !FB) resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
        
            if ( !fbApiInited ) {
                FB.init({
                    appId:fbApplicationId,
                    cookie:true,
                    xfbml: true,
                    version: 'v2.5',
                    oauth:true
                });
        
                fbApiInited = true;
            }
        
            FB.login(loginStatus, {
                scope: 'email, public_profile'
            });

        })
    }
    
    function shareFacebook(planHash, lang, style) {
        if (typeof planHash != "undefined" && typeof lang != "undefined") {
            var urlFb   = "<?=$fb_share_url?>";
            var params  = "width=600,height=400,toolbar=0,status=0";
    
            urlFb       = urlFb.replace("{hash}", planHash);
            urlFb       = urlFb.replace("{rand}", getRand(111, 9999));
            urlFb       = urlFb.replace("{lang}", lang);
    
            if (style) {
                urlFb   = urlFb.replace("{style}", style);
            }
    
            var shareWindow = window.open(urlFb, 'Share facebook', params);
            shareWindow.focus();
    
            return false;
        }
    }
    
    function getRand (min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}
R2D.UserCore.UserGoogle = function (user) {

    var googleApiInited = false;

    let me = this;

    me.googleLogin = () => {
        return new Promise((resolve, reject) => {
            function loginUserViaGoogle(response) {
                async function loaderEventHandler(event) {

                    var loader = event.currentTarget;

                    loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
                    loader.removeEventListener(Event.ERROR, loaderEventHandler);
                    loader.close();
                    loader = null;

                    if (event.type == Event.COMPLETE) {
                        let result = parseLoginData(event.data.data);
                        if (result) {
                            user.setUserData(result);
                            let favorites = await user.uGetFavorites();
                            if (favorites.type == 'error') console.error(favorites.data);
                            else result.favorites = favorites.data;


                            resolve({logged: true});
                        }
                    } else {
                        console.error("Error!");
                        resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                    }
                }

                // function onResponse(userData) {
                //     body: JSON.stringify({ credential: response.credential })
                const data = {
                    credential: response.credential
                }
                var loader = R2D.XHRLoader.getPostLoader(R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_SIGN_IN_VIA_GOOGLE), R2D.XHRLoader.makeParamsString(data), null, null, true);

                loader.addEventListener(Event.COMPLETE, loaderEventHandler);
                loader.addEventListener(Event.ERROR, loaderEventHandler);

                // }

                function parseLoginData(data) {
                    var object = null;

                    try {
                        object = JSON.parse(data);

                    } catch (error) {
                        resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                        return;
                    }

                    if (!object.hasOwnProperty('status')) {
                        resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                    } else if (object['status'] == 'error') {
                        console.error(object);

                        if (object.data && object.data.error_message == 'user not activated' && object.redirect) {
                            let url = R2D.makeURL(R2D.URL.DOMAIN, object.redirect);

                            let loader = new R2D.XHRLoader();

                            loader.addEventListener(Event.COMPLETE, loaderActivateListener);
                            loader.addEventListener(Event.ERROR, loaderActivateListener);
                            loader.load(url, null, 'GET', null, null, true);

                            function loaderActivateListener(e) {
                                e.currentTarget.removeEventListener(Event.COMPLETE, loaderActivateListener);
                                e.currentTarget.removeEventListener(Event.ERROR, loaderActivateListener);

                                if (e.type == Event.COMPLETE) {
                                    resolve({
                                        type: "error",
                                        message: "not_active_account",
                                        data: "TEXT_REGISTRATION_ACTIVATE"
                                    });
                                } else {
                                    resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                                }
                            }
                        } else {
                            resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                        }
                    } else if (!object.hasOwnProperty('data')) {
                        resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
                    } else {
                        return object['data'];
                    }
                }
            }


            if (!window.google || !google.accounts || !google.accounts.id) {
                resolve({type: "error", message: "error_load", data: "TEXT_ERROR_LOAD_DATA"});
            }

            // if (!googleApiInited) {
            google.accounts.id.initialize({
                client_id: googleClientId,
                context: 'signin',
                callback: loginUserViaGoogle,
            });

            googleApiInited = true;
            // }


            google.accounts.id.prompt(notification => {
                if (notification.isNotDisplayed()) {
                    console.log(notification.getNotDisplayedReason())
                } else if ('isSkippedMoment', notification.isSkippedMoment()) {
                    console.log(notification.getSkippedReason())
                } else if('getSkippedReason', notification.isDismissedMoment()) {
                    console.log('isDismissedMoment', notification.getDismissedReason())
                }
                // continue with another identity provider.
            });
        })
    }

}
R2D.UserCore.UserSettings = function(user) {

    this.settingsItemClick = settingsItemName =>
    {
        switch ( settingsItemName )
        {
            case "snapToPoints":
                WC.snapTool.pointsSnap = !WC.snapTool.pointsSnap;
                break;

            case "alignByPoints":
                WC.snapTool.pointsAlign = !WC.snapTool.pointsAlign;
                break;

            case "alignAxises":
                WC.snapTool.orthoAlign = !WC.snapTool.orthoAlign;
                break;

            case "alignMediana":
                WC.snapTool.bisectorAlign = !WC.snapTool.bisectorAlign;
                break;

            case "showSizes":
                WC.wallsEditor.sizesVisible = !WC.wallsEditor.sizesVisible;
                WC.wallsEditor.draw();
                break;
        }
}
}

//core
R2D = R2D || {};

R2D.extend = extend;
R2D.domParser = (() => {
    var domParser = new DOMParser();

    return html => {
        let body = domParser.parseFromString(html, 'text/html').body;
        let children = body.children;
        let removed = [];

        for ( let i = 0, l = children.length; i < l; i++ ) {
            removed.push(children[i]);
            body.removeChild(children[i]);
        }

        return removed;
    }
})();

R2D.addAsUnique = function(array, value) {
    for ( var i = 0, l = array.length; i < l; i++ ) {
        if ( array[i] == value ) return false;
    }

    array.push(value);

    return true;
};
R2D.postMessageToParent = function(string) {
    if ( window.parent == window ) return;

    window.parent.postMessage(string, '*');
};

//-
R2D.RenderUpdater = function() {
    var frames = 5;
    var frame = 0;
    var onStart = null;
    var onProgress = null;
    var onFinish = null;

    function update()
    {
        if ( frame <= 0 )
        {
            if ( onFinish ) {
                onFinish();
            }
            return;
        }

        frame -= 1;

        if (onProgress) {
            onProgress();
        }

        requestAnimationFrame(update);
    }

    this.setFrames = function(number) {
        frames = number;
    };
    this.needsUpdate = function()
    {
        if ( frame > 0 )
        {
            frame = frames;
        } else {
            frame = frames;

            if ( onStart ) {
                onStart();
            }

            update();
        }
    };
    this.onStart = function(callback) {
        onStart = callback;
    };
    this.onProgress = function(callback) {
        onProgress = callback;
    };
    this.onFinish = function(callback) {
        onFinish = callback;
    };
    this.isRunning = function()
    {
        //console.log(frame);
        return frame > 0;
    }
};

R2D.protocols = ['http://', 'https://'];
R2D.makeURL = function(domain, path = '') {
    for ( var i = 0, l = R2D.protocols.length; i < l; i++ ) {
        if ( path.substring(0, R2D.protocols[i].length) == R2D.protocols[i] ) {
            return path;
        }
    }

    return domain + path;
};
R2D.detectWebGL = function() {
    var canvas = document.createElement('canvas');

    if ( !canvas ) return false;

    return !!(canvas.getContext('webgl') || canvas.getContext("experimental-webgl"));
};


//console
console.printModule = function(name) {
    console.log('%c' + name, 'background: #000000; color: #ffffff; padding: 3px;');
};
console.printError = function(text) {
    console.log('%c' + text, 'background: #ffcccc; color: #CF0019; padding: 3px;');
};
console.printWarn = function(text) {
    console.log('%c' + text, 'background: #FFF992; color: #585300; padding: 3px;');
};
console.printDone = function(text) {
    console.log('%c' + text, 'background: #69FF40; color: #444444; padding: 3px;');
};
//loaders

R2D.XHRLoader = function() {
    EventDispatcher.call(this);

    var scope = this;

    scope.url = null;
    scope.params = null;
    scope.method = null;
    scope.headers = null;
    scope.xhr = null;
    scope.data = null;

    function xhrEventHandler(event) {
        scope.xhr.removeEventListener("load", scope.xhrEventHandler);
        scope.xhr.removeEventListener("error", scope.xhrEventHandler);

        if ( event.type == "load" && scope.xhr.status == "200" ) {
            scope.data = scope.xhr.response;
            scope.dispatchEvent(new Event(Event.COMPLETE, scope));
        } else {
            scope.dispatchEvent(new Event(Event.ERROR, scope));
        }
    }

    scope.load = function(url, params, method, headers, responseType, withCredentials, needToken = true, token)
    {
        if ( !url ) throw "Error XHRLoader's url!";
        if ( !params ) params = "";
        if ( !method ) method = "GET";
        if ( !headers ) headers = [];

        if (needToken && (token || R2D.token))
        {
            headers.push({header: "x-token", value: token || R2D.token});
        }

        if (needToken && R2D.language)
        {
            headers.push({header: "x-lang", value: R2D.language});
        }

        scope.url = url;
        scope.params = params;
        scope.method = method;
        scope.headers = headers;
        scope.responseType = responseType || "";
        scope.xhr = new XMLHttpRequest();

        scope.xhr.open(method, url, true);
        scope.xhr.responseType = scope.responseType;
        scope.xhr.withCredentials = withCredentials;

        for ( var i = 0, l = headers.length; i < l; i++ ) {
            scope.xhr.setRequestHeader(headers[i].header, headers[i].value);
        }

        scope.xhr.addEventListener("load", xhrEventHandler);
        scope.xhr.addEventListener("error", xhrEventHandler);
        scope.xhr.send(params);
    };
    scope.close = function() {
        scope.url = null;
        scope.params = null;
        scope.method = null;
        scope.headers = null;

        if ( scope.xhr ) {
            scope.xhr.abort();
            scope.xhr.removeEventListener("load", xhrEventHandler);
            scope.xhr.removeEventListener("error", xhrEventHandler);
            scope.xhr = null;
        }
    };
};

R2D.extend(R2D.XHRLoader, EventDispatcher);

/**
 *
 * @param {Object} object 
 * @returns {string}
 */
R2D.XHRLoader.makeParamsString = function(object) {
    var string = '';
    var amp = '';

    for ( var key in object ) {
        string += amp + key + '=' + object[key];
        amp = '&';
    }

    return string;
};
/**
 *
 * @param {String} url
 * @param {String} params
 * @param {String} headers
 * @param {String} responseType
 * @param {Boolean} withCredentials
 * @returns {R2D.XHRLoader}
 */
R2D.XHRLoader.getPostLoader = function(url, params, headers, responseType, withCredentials) {
    var loader = new R2D.XHRLoader();
    var postHeader = {
        header:"Content-type",
        value:"application/x-www-form-urlencoded"
    };

    if ( headers ) headers.push(postHeader);
    else headers = [postHeader];
    
    loader.load(url, params, 'POST', headers, responseType, withCredentials);

    return loader;
};
R2D.UserCore.UserAutoSave = function(user)
{
    let me = this;
    let loader = null;

    me.updateAutoSave = function(data)
    {
        return new Promise((resolve, reject) => {
            
            let params = JSON.stringify(data);
    
            loader = R2D.XHRLoader.getPostLoader(R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_AUTO_SAVE_UPDATE), params, null, null, true);
    
            loader.addEventListener(Event.COMPLETE, loaderSetListener);
            loader.addEventListener(Event.ERROR, loaderSetListener);
    
            async function loaderSetListener(e) {
                loader.removeEventListener(Event.COMPLETE, loaderSetListener);
                loader.removeEventListener(Event.ERROR, loaderSetListener);

                if ( e.type == Event.COMPLETE ) {
                    let autoSaveUpdateResult = parseAutoSaveUpdateData(e.data.data);
                    if (autoSaveUpdateResult)
                    {
                        resolve({type: 'success: ', data: e.data});
                    }
                } else {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }   
            }

            function parseAutoSaveUpdateData(data) {
                let object = null;

                try {
                    object = JSON.parse(data);
                    
                } catch ( error ) {
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                    return;
                }

                if ( object['status'] != 'ok' ) {
                    console.error('Error! Received data status is not "ok"!');
                    console.log(object);
                    resolve({type: "error", data: "TEXT_ERROR_LOAD_DATA"});
                }
                else
                {
                    return true;
                }
            }
        });
    };

};