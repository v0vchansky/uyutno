var fbApiInited = false;

function loginUserViaFb(token, callback) {

    function loaderEventHandler(event) {
        var loader = event.currentTarget;

        loader.removeEventListener(Event.COMPLETE, loaderEventHandler);
        loader.removeEventListener(Event.ERROR, loaderEventHandler);
        loader.close();
        loader = null;

        //R2D.DialogStage.hide(windowWait);

        if ( event.type == Event.COMPLETE ) {
            if (callback) callback(event.data.data);
        } else {
            console.error("Error!");
            console.log(event.data.data);
            showAlertWindow(R2D.TRANSLATION.TEXT_ERROR_LOAD_DATA, R2D.TRANSLATION.BUTTON_OK);
        }
    }
    function onResponse(userData) {
        var data = {
            email       : userData.email,
            name        : userData.name,
            token       : token,
            social_net  : 1
        };
        var loader = R2D.XHRLoader.getPostLoader(R2D.makeURL(R2D.URL.DOMAIN, R2D.URL.URL_SIGN_IN_VIA_FB), R2D.XHRLoader.makeParamsString(data), null, null, true);

        loader.addEventListener(Event.COMPLETE, loaderEventHandler);
        loader.addEventListener(Event.ERROR, loaderEventHandler);
    }

    FB.api('/me', {
        fields: 'id, name, email'
    }, onResponse);
}

function facebookLogin(callback) {
    function loginStatus(response) {
        console.log('loginStatus', response);
        if ( response.status == "connected" ) {
            console.log(response);
            loginUserViaFb(response.authResponse.accessToken, callback);
        } else {
            console.warn('User cancelled login or did not fully authorize.');
            //R2D.DialogStage.hide(windowWait);
        }
    }

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


