'use strict';

async function tryGetNotificationsApproval() {
    if(Notification.permission === "granted") {
        return true;
    }
    else {
        const permission = await Notification.requestPermission();
        if(permission === 'granted') {
            return true;
        }
    }
    return false;
}

function createNotification(title, text, icon) {
    const notif = new Notification(title, {
        body: text,
        ison: icon
    });
    notif.onclick = function(event) {
        event.preventDefault(); // prevent the browser from focusing the Notification's tab
        window.location.href = "/";
    }
}

const checkWorkerPush = () => {
    if (!('serviceWorker' in navigator)) {
        console.warn('No Service Worker support!');
        return false;
    }
    if (!('PushManager' in window)) {
      console.warn('No Push API Support!');
      return false;
    }
    return true;
}

const getSubscriptionKey = async subscription => {
    const response = await fetch("/user/push_subscriptions/begin", {
      method: 'post',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(subscription),
    });
    return response.json();
  }

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = atob(base64);
    var outputArray = new Uint8Array(rawData.length);

    for (var i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

const saveSubscription = async subscription => {
    const response = await fetch("/user/push_subscriptions/finish", {
      method: 'post',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(subscription),
    });
    return response;
  }

const registerServiceWorker = async () => {
    if (!('PushManager' in window)) {
        console.warn("pushManager not available");
        return false;
    }
    if (!('serviceWorker' in navigator)) {
        console.warn("Service Worker not available");
        return false;
    }
    let swRegistration = await navigator.serviceWorker.register('/service.js');
    swRegistration = await navigator.serviceWorker.ready;
    console.log("Registered service worker");
    const existingSubscription = await swRegistration.pushManager.getSubscription();
    if (existingSubscription){
        console.log("Already subscribed to push notifications");
        return true;
    }

    try {
        const vapid = await getSubscriptionKey();
        const applicationServerKey = urlBase64ToUint8Array(vapid.PublicKey);
        const options = { applicationServerKey: applicationServerKey, userVisibleOnly: true};
        const subscription = await swRegistration.pushManager.subscribe(options);
        const response = await saveSubscription(subscription);
    } catch (err) {
        console.log('Error', err);
        return false;
    }
    return true;
}

// Force service worker reload during dev
if (new URLSearchParams(window.location.search).has('sw')) {
    console.log("Going to reload SW");
    navigator.serviceWorker.getRegistration("/assets/service.js").then(function(reg) {
        if (reg) {
            console.log("Reloading Service Worker");
            reg.unregister().then(function() {
                window.location.href = "/";
            });
        } 
    });
}


// Inspired by https://github.com/hbolimovsky/webauthn-example/blob/master/index.html

async function webAuthNRegisterStart(allowCrossPlatformDevice = false) {
    let provider = "webauthn";
    if (!allowCrossPlatformDevice) {
        provider = "touchid";
    }
    $(`#${provider}-icon`).addClass("fadein-animated");

    const response = await fetch(`/auth/webauthn/beginregister?type=${provider}`, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
    });
    if (response.status == 401) {
        window.location.href = "/";
    }
    if (response.status !== 200) {
        console.error(response);
        $("#error").show();
        return;
    }
    let optionsData = await response.json();
    optionsData.publicKey.user.id = bufferDecode(optionsData.publicKey.user.id);
    optionsData.publicKey.challenge = bufferDecode(optionsData.publicKey.challenge);

    // Not sure how to set that using the server webauthn library so overriding here...
    if(allowCrossPlatformDevice == false) {
        optionsData.publicKey.allowCredentials = [
            { 
                type: "public-key", 
                id: optionsData.publicKey.user.id, 
                transports: ["internal"]
            },
        ];
    }
    
    let newCredentialInfo;
    try{
        newCredentialInfo = await navigator.credentials.create(optionsData);
    }
    catch (e) {
        $(`#${provider}-icon`).removeClass("fadein-animated");
        $("#error").html(`<b>Unable to register your security device. </b>`);
        $("#error").show();
        return;
    }

    const attestationObject = newCredentialInfo.response.attestationObject;
    const clientDataJSON = newCredentialInfo.response.clientDataJSON;
    const rawId = newCredentialInfo.rawId;
    const regoResponse = {
        id: newCredentialInfo.id,
        rawId: bufferEncode(rawId),
        type: newCredentialInfo.type,
        response: {
            attestationObject: bufferEncode(attestationObject),
            clientDataJSON: bufferEncode(clientDataJSON),
        },
    };
    const registerResponse = await fetch(`/auth/webauthn/finishregister?type=${provider}`, {
        method: "POST",
        body: JSON.stringify(regoResponse),
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
    });
    if (registerResponse.status !== 200) {
        console.error(registerResponse);
        $("#error").show();
        return;
    }
    else {
        window.location.href = `/success?source=register&provider=${provider}`;
    }
}

async function webAuthNLogin(allowCrossPlatformDevice = false) {
    $("#touchid-icon").addClass("fadein-animated");
    let provider = "webauthn";
    if (!allowCrossPlatformDevice) {
        provider = "touchid";
    }
    const response = await fetch(`/auth/webauthn/beginlogin?type=${provider}`, {
        method: 'POST',
        headers: {
            'Accept': 'application/json'
        },
    });
    if (response.status == 401) {
        window.location.href = "/";
    }
    if (response.status !== 200) {
        console.error(response);
        $("#error").show();
        return;
    }
    let credentialRequestOptions = await response.json();
    credentialRequestOptions.publicKey.challenge = bufferDecode(credentialRequestOptions.publicKey.challenge);
    credentialRequestOptions.publicKey.allowCredentials.forEach(function (listItem) {
        listItem.id = bufferDecode(listItem.id)
    });
    credentialRequestOptions.mediation = "silent";

    let assertion;
    try{
        assertion = await navigator.credentials.get(credentialRequestOptions);
    }
    catch (e) {
        $("#touchid-icon").removeClass("fadein-animated");
        $("#error-new-device").show();
        return;
    }
    const authData = assertion.response.authenticatorData;
    const clientDataJSON = assertion.response.clientDataJSON;
    const rawId = assertion.rawId;
    const sig = assertion.response.signature;
    const userHandle = assertion.response.userHandle;

    const loginResponseData = {
        id: assertion.id,
        rawId: bufferEncode(rawId),
        type: assertion.type,
        response: {
            authenticatorData: bufferEncode(authData),
            clientDataJSON: bufferEncode(clientDataJSON),
            signature: bufferEncode(sig),
            userHandle: bufferEncode(userHandle),
        },
    };
    const loginResponse = await fetch(`/auth/webauthn/finishlogin?type=${provider}`, {
        method: "POST",
        body: JSON.stringify(loginResponseData),
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
    });
    if (!loginResponse.ok) {
        console.error(loginResponse);
        $("#error").show();
        return;
    }
    else {
        window.location.href = "/success";
    }
}

async function getSingleUseCode() {
    const otcResponse = await fetch("/auth/otc/generate", {
        method: "POST",
        headers: {
            'Accept': 'application/json'
        },
    });
    if (!otcResponse.ok) {
        console.error(otcResponse);
        $("#error").text(otcResponse.statusText);
        $("#error").show();
        return;
    }
    else {
        const code = await otcResponse.json();
        $("#temp-code-value").text(code.Code);
        $("#temp-code-value").show();
        $("#temp-code-expiry").text(`This code is valid until ${new Date(code.ExpiresAt).toLocaleString()}`);
    }
}

// ArrayBuffer to URLBase64
function bufferEncode(value) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(value)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
}

// Base64 to ArrayBuffer
function bufferDecode(value) {
    return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}

// Remove all occurrences of an item from an array
function removeAllFromArray(arr, value) {
    var i = 0;
    while (i < arr.length) {
        if (arr[i] === value) {
            arr.splice(i, 1);
        } else {
            ++i;
        }
    }
    return arr;
}

  
function startListenSSE() {
    console.log("Enable SSE fallback for VPN connection notifications");
    const source = new EventSource('/events');
    source.onopen = function() {
        console.log('Connection to SSE stream has been opened');
    };
    source.onerror = function (error) {
        console.warn('SSE error', error);
    };
    source.onmessage = function (stream) {
        console.log(`${new Date()} Received SSE message`, stream);
        if (stream.data) {
            const event = JSON.parse(stream.data);
            if (event.Action == "Auth") {
                console.log("RECEIVED AUTH EVENT");
                SendAuthProof(event);
            }
        }
    };
}

async function SendAuthProof(data, notificationsEnabled) {
    const updateAuthResponse = await fetch(`/user/auth/refresh?source=sse`, {
        method: "POST",
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    });
    if (updateAuthResponse.status == 401 && userInfo.EnableNotifications == true) {
        createNotification(`${data.Issuer}: authentication required`, "Click to authenticate", data.IconURL);
    }
}

// Submits an OTP or OTC for validation
async function validateOneTimePass(isOTC, code) {
    let url = "/auth/otp/validate";
    if (isOTC) {
        url = "/auth/otc/validate";
    }
    const codeResponse = await fetch(url, {
        method: "POST",
        body: JSON.stringify(
            { Code: code }
        ),
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
    });
    if (!codeResponse.ok) {
        console.error(codeResponse);
        /*if(codeResponse.statusText != "") {
            $("#error").text(codeResponse.statusText);
        }*/
        $("#error").show();
    }
    else {
        if (isOTC) {
            window.location.href = "/auth/getmfachoice";
        }
        else {
            window.location.href = "/success";
        }
    }
}

var userInfo = {};

// main
$(document).ready(async function(){
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.has('error')) {
        $("#error").show();
    }

    let mfaOptions = [];
    if (searchParams.has('options')) {
        mfaOptions = searchParams.get('options').split(",");
        removeAllFromArray(mfaOptions, "");
        if(!mfaOptions.includes("webauthn")) {
            console.log("Webauthn is not allowed");
            $("#webauthn-section").hide();
        }
        if(!mfaOptions.includes("otp")) {
            console.log("OTP is not allowed");
            $("#otp-section").hide();
        }
        if(!mfaOptions.includes("touchid")) {
            console.log("TouchID is not allowed");
            $("#touchid-section").hide();
        }
        // This one is very specific, so hidden by default
        if(mfaOptions.includes("code")) {
            console.log("Single usage code is allowed");
            $("#otc-section").show();
        }
    }

    if (!window.PublicKeyCredential) { // Browser without any Webauthn support
        removeAllFromArray(mfaOptions, "touchid");
        removeAllFromArray(mfaOptions, "webauthn");
        $("#touchid-section").hide();
        $("#webauthn-section").hide();
    }
    else {
        const tpmAuthAvailable = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        if(tpmAuthAvailable){
            console.log("TouchID/FaceID/Windows Hello is available.");
        } else {
            console.log(`TouchID/FaceID/Windows Hello available: ${tpmAuthAvailable}`);
            removeAllFromArray(mfaOptions, "touchid");
            $("#touchid-section").hide();
        }
    }
    // If no MFA options to choose from, the user is most likely trying to sign in from a new browser and only had webauthn MFAs configured.
    // Show the option to use an OTC from another registered device/browser
    console.log(`MFA options=${mfaOptions}, length=${mfaOptions.length}`);
    if (mfaOptions.length == 0) {
        $("#error-new-device").show();
    }

    // Fetch and display user and session info.
    const userResponse = await fetch("/user/info", {
        method: "GET",
        headers: {
            'Accept': 'application/json',
        },
    });
    if (!userResponse.ok) {
        if(userResponse.statusText != "") {
            $("#error").text(userResponse.statusText);
        }
        $("#error").show();
        return;
    }
    else {
        userInfo = await userResponse.json();
        if (userInfo.FullyAuthenticated && window.location.pathname == "/") {
            window.location.href = "/success";
        }
        else if (!userInfo.FullyAuthenticated && window.location.pathname == "/success") {
            window.location.href = "/";
        }
        
        console.log(`userInfo: ${JSON.stringify(userInfo)}`);
    }
    // Set placeholders values with data from userInfo
    $("[name='data-connection-name']").each(function() {
        $(this).text(userInfo.Issuer);
    });
    $("#data-session-validity").text(new Date(userInfo.SessionExpiry * 1000).toLocaleString());

    if ('permissions' in navigator && !("ontouchstart" in document.documentElement)) {
        const notificationPerm = await navigator.permissions.query({name:'notifications'});
        console.log(`Notifications are ${notificationPerm.state}`);
        if (notificationPerm.state === "granted") {
            await registerServiceWorker();
        }
        // Watch for permissions change if user denies notifications but later enables them
        notificationPerm.onchange = async function() {
            if (notificationPerm.state !== "denied") {
                 const notificationsApproved = await tryGetNotificationsApproval();
                 const pushWorker =  await registerServiceWorker();
                 if (notificationsApproved && !pushWorker) {
                    $("#notification-restricted-support-warning").show();
                    startListenSSE();    
                 }
            }
            else { // currently only shown if user is at the success page
                $("notification-warning").show();
            }
        };
    }

    // If notifications are enabled and the user allowed them, enable either
    // Service Worker or SSE.
    if (userInfo.EnableNotifications && !("ontouchstart" in document.documentElement)) {
        console.log(`Notification.permission=${Notification.permission}`);
        const hasWorkerPush = checkWorkerPush();
        if (Notification.permission === "default") {
            $("#notification-info").show();
        }
        else if (Notification.permission === "denied") {
            $("#notification-warning").show();
        }
        if (!hasWorkerPush && Notification.permission === "granted") {
            $("#notification-restricted-support-warning").show();
            startListenSSE();
        }
    }

    $("#login-touchid").click(function() {
        webAuthNLogin(false);
    });
    $("#login-webauthn").click(function() {
        webAuthNLogin(true);
    });
    $("#register-touchid").click(function() {
        webAuthNRegisterStart(false);
    });
    $("#register-webauthn").click(function() {
        webAuthNRegisterStart(true);
    });
    $("#register-otc").click(function() {
        getSingleUseCode();
    });
    $("#allow-notifications").click(function() {
        if (tryGetNotificationsApproval()) {
            registerServiceWorker();
            $("#allow-notifications").addClass("disabled");
            $("#allow-notifications-icon").text("check_circle");
            // FIXME: Reload is apparently needed to ensure the Service Worker is linked to the page, despite calling claim()
            setTimeout(location.reload.bind(location), 3000);
        }
    });

    $("#otp").keyup( async function() {
        const dataLength = $(this).val().length;
        if(dataLength > 0) {
            $("#error").hide();
        }
        if (dataLength == 6) {
            await validateOneTimePass(false, $(this).val());
            $(this).val("");
        }
    }).change();

    $("#otc").keyup( async function() {
        const dataLength = $(this).val().length;
        if(dataLength > 0) {
            $("#error").hide();
        }
        if (dataLength == 6) {
            await validateOneTimePass(true, $(this).val());
            $(this).val("");
        }
    }).change();
    
    const otpHandler = async function() {
      const dataLength = $('#otp').val().length;
      if(dataLength > 0) {
          $("#error").hide();
      }
      if (dataLength == 6) {
          await validateOneTimePass(false, $('#otp').val());
          $('#otp').val("");
      } else {
        $("#error").show();
      }
    }
    
    const otcHander = async function() {
      const dataLength = $('#otc').val().length;
      if(dataLength > 0) {
        $("#error").hide();
      }
      if (dataLength == 6) {
          await validateOneTimePass(true, $('#otc').val());
          $('#otc').val("");
      } else {
        $("#error").show();
      }
    }
    
    if(document.getElementById('otp-button')) {
      $('#otp-button').on('click', otpHandler);
      document.getElementById('otp-button').addEventListener('touchstart', otpHandler);
    }
    if(document.getElementById('otc-button')) {
      $('#otc-button').on('click', otcHander);
      document.getElementById('otc-button').addEventListener('touchstart', otcHander);
    }
});