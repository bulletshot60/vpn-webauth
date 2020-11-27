'use strict';

function askForApproval() {
    if(Notification.permission === "granted") {
        //createNotification('Wow! This is great', 'created by @study.tonight', 'https://www.studytonight.com/css/resource.v2/icons/studytonight/st-icon-dark.png');
    }
    else {
        Notification.requestPermission(permission => {
            if(permission === 'granted') {
                //createNotification('Wow! This is great', 'created by @study.tonight', 'https://www.studytonight.com/css/resource.v2/icons/studytonight/st-icon-dark.png');
            }
        });
    }
}

function createNotification(title, text, icon) {
    const notif = new Notification(title, {
        body: text,
        ison: icon
    });
    notif.onclick = function(event) {
        event.preventDefault(); // prevent the browser from focusing the Notification's tab
        window.open('https://vpn.massdm.cloud');
    }
}

const checkWorkerPush = () => {
    if (!('serviceWorker' in navigator)) {
      throw new Error('No Service Worker support!');
    }
    if (!('PushManager' in window)) {
      console.warn('No Push API Support!');
    }
    
  }

const registerServiceWorker = async () => {
    const swRegistration = await navigator.serviceWorker.register('/assets/service.js');
    console.log("Registered service worker");
    return swRegistration;
}

askForApproval();
checkWorkerPush();
registerServiceWorker();
console.log("Going to create a notification");
// 'https://www.ascendaloyalty.com/wp-content/uploads/2018/10/logo_footer.png');

navigator.serviceWorker.addEventListener('message', (event) => {
    console.log('Received a message from service worker: ', event.data);
    createNotification('Ascenda VPN',  "Click to authenticate", 'https://www.ascendaloyalty.com/wp-content/uploads/2018/10/logo_footer.png');
});

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

    let attestationObject = newCredentialInfo.response.attestationObject;
    let clientDataJSON = newCredentialInfo.response.clientDataJSON;
    let rawId = newCredentialInfo.rawId;
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
    let credentialRequestOptions = await response.json();
    console.log(credentialRequestOptions)
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
        $("#error").html(`<b>You may be trying to authenticate from a new device or browser. <br/>
            Sign in using your allowed device or browser, and click 'Add new browser or device'.<br/>
            This will allow you to generate a one time code.<br/>
            Click <a href="/enter2fa?options=code">here</a> to enter a one time code.
            </b>`);
        $("#error").show();
        return;
    }
    
    let authData = assertion.response.authenticatorData;
    let clientDataJSON = assertion.response.clientDataJSON;
    let rawId = assertion.rawId;
    let sig = assertion.response.signature;
    let userHandle = assertion.response.userHandle;

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
    const codeResponse = await fetch("/auth/code/generate", {
        method: "POST",
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
    });
    if (!codeResponse.ok) {
        console.error(codeResponse);
        $("#error").text(codeResponse.statusText);
        $("#error").show();
        return;
    }
    else {
        const code = await codeResponse.json();
        $("#temp-code-value").text(code.code);
        $("#temp-code-value").show();
        $("#temp-code-expiry").text(`This code is valid until ${new Date(code.expires_at).toLocaleString()}`);

    }
}

$(document).ready(async function(){
    const searchParams = new URLSearchParams(window.location.search);

    if (searchParams.has('error')) {
        $("#error").show();
    }

    if (searchParams.has('options')) {
        const allOptions = searchParams.get('options').split(",");
        if(!allOptions.includes("webauthn")) {
            console.log("Webauthn is not allowed");
            $("#webauthn-section").hide();
        }
        if(!allOptions.includes("otp")) {
            console.log("OTP is not allowed");
            $("#otp-section").hide();
        }
        if(!allOptions.includes("touchid")) {
            console.log("TouchID is not allowed");
            $("#touchid-section").hide();
        }
        // This one is very specific, so hidden by default
        if(allOptions.includes("code")) {
            console.log("Single usage code is allowed");
            $("#code-section").show();
        }
    }

    if (!window.PublicKeyCredential) { // Browser without any Webauthn support
        $("#touchid-section").hide();
    }
    else {
        const tpmAuthAvailable = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        if(tpmAuthAvailable){
            console.log("TouchID/FaceID/Windows Hello is available.");
        } else {
            console.log(`TouchID/FaceID/Windows Hello available: ${tpmAuthAvailable}`);
            $("#touchid-section").hide();
        }
    }

    let sessionValidity = $("#session-validity").text();
    if (sessionValidity != "") {
        let expiry = new Date();
        expiry.setSeconds(expiry.getSeconds() + parseInt($("#session-validity").text()));
        $("#session-validity").text(expiry.toLocaleString());
    }

    // Success page: check if it was a registration or a login
    if (searchParams.has('source')) {
        const source = searchParams.get('source');
        const provider = searchParams.get('provider');
        if (source == "register" && (provider == "webauthn" || provider == "touchid")) {
            $("#success-info-message").html(`The next times you sign in, you will need to use the same browser, <br/>
            or any other browser added using the "Add new browser or device" option.`);
            $("#success-info").show();
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


    $("#otp").keyup( function() {
        const dataLength = $(this).val().length;
        
        if(dataLength > 0) {
            $("#error").hide();
        }
        if (dataLength == 6) {
            $("#otp-form").submit();
        }
    }).change();

    $("#code").keyup( async function() {
        const dataLength = $(this).val().length;
        
        if(dataLength > 0) {
            $("#error").hide();
        }
        if (dataLength == 6) {
            // TODO: Move to function
            const codeResponse = await fetch("/auth/code/validate", {
                method: "POST",
                body: JSON.stringify(
                    { code: $(this).val() }
                ),
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
            });
            if (!codeResponse.ok) {
                console.error(codeResponse);
                if(codeResponse.statusText != "") {
                    $("#error").text(codeResponse.statusText);
                }
                $("#error").show();
                return;
            }
            else {
                window.location.href = "/auth/getmfachoice";
            }
        }
    }).change();
});


// ArrayBuffer to URLBase64
function bufferEncode(value) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(value)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");;
}

// Base64 to ArrayBuffer
function bufferDecode(value) {
    return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}

