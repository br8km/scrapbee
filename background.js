import {settings, global} from "./settings.js";
import {log} from "./message.js";
import {showNotification} from "./utils.js";
import {sendTabContentMessage, executeScriptsInTab, ajaxFormPost, gtev, downloadFile} from "./utils.js";

/* logging */
var log_pool = [];
log.sendLog = function(logtype, content){
    if(typeof content != "string"){
        content = String(content);
    }
    var log = {logtype:logtype, content: content.htmlEncode()};
    log_pool.push(log);
    browser.runtime.sendMessage({type:'LOGGING', log});
};
log.clear = function(){
    log_pool = [];
};
/* log version and platform */
var browser_info_status = "";
function loadBrowserInfo(){
    return new Promise((resolve, reject) => {
        if(browser_info_status == "loaded"){
            resolve();
        } else if(browser_info_status == "loading"){
            function wait(){
                setTimeout(function(){
                    if(browser_info_status == "loaded"){
                        resolve();
                    }else{
                        wait();
                    }
                }, 1000);
            }
            wait();
        } else {
            browser_info_status = "loading";
            browser.runtime.getBrowserInfo().then(function(info) {
                var manifest = browser.runtime.getManifest();
                log.info("version = " + manifest.version);
                log.info("browser = " + info.name + " " + info.version);
                var main_version = parseInt(info.version.replace(/\..+/, ""));
                if(info.name != "Firefox" || main_version < 60){
                    var em = "Only Firefox version after 60 is supported";
                    log.error(em);
                    browser_info_status = "error";
                    reject(Error(em))
                }else{
                    log.info("platform = " + navigator.platform);
                    browser_info_status = "loaded";
                    resolve();
                }
            });
        }
    });
}
loadBrowserInfo().then(async () => {
    await settings.loadFromStorage();
    startWebServer(5, "background");
})
/* backend*/
var backend_inst_port;
var web_status;
var backend_version;
function communicate(command, body, callback){
    return new Promise((resolve, reject)=>{
        if(!backend_inst_port){
            backend_inst_port = browser.runtime.connectNative("scrapbee_backend");
            backend_inst_port.onDisconnect.addListener((p) => {
                if (p.error) {
                    var em = `backend disconnected due to an error: ${p.error.message}`
                    // log.error(em);
                    reject(Error(em));
                }else{
                    var em = `backend disconnected`;
                    // log.error(em);
                    reject(Error(em));
                }
            });
        }
        if(backend_inst_port.error){
            reject(backend_inst_port.error);
        }else{
            body.command = command;
            backend_inst_port.postMessage(JSON.stringify(body));
            var listener = (response) => {
                resolve(response)
                backend_inst_port.onMessage.removeListener(listener);
            };
            backend_inst_port.onMessage.addListener(listener);
        }
    });
}
function startWebServer(try_times, debug){
    if(web_status == "failed"){
        return  Promise.reject(Error("start web server: failed"));
    }
    function showInfo(r){
        var version = r.Version || 'unknown';
        backend_version = version;

        
        settings.set("backend_version", version, true)
        log.info(`backend service started (${debug}), version = ${version}`);
        if(!gtev(version, '1.7.2')){
            log.error(`backend >= 1.7.2 wanted for full functions, please update`)
        }
        web_status = "launched";
        browser.runtime.sendMessage({type: 'BACKEND_SERVICE_STARTED', version});
    }
    return new Promise((resolve, reject) => {
        settings.loadFromStorage().then(()=>{
            var port = settings.backend_port;
            var pwd = settings.backend_pwd;
            if(web_status == "launched"){
                resolve();
            }else if(settings.backend_type == "address"){
                web_status = "launched"
                var address = settings.getBackendAddress();
                log.info(`connect backend address: ${address}`);
                $.get(address + `serverinfo/?pwd=${settings.backend_pwd}`, function(r){
                    showInfo(r);
                    resolve();
                }).fail(function(e){
                    if(e.status > 0){
                        showInfo({});
                        resolve();
                    }else{
                        log.error("Failed to connect backend")
                    }
                });
            } else if(web_status == "launching"){
                function wait(){
                    setTimeout(function(){
                        if(web_status == "launched"){
                            resolve();
                        }else{
                            wait();
                        }
                    }, 1000);
                }
                wait();
            } else {
                web_status = "launching";
                loadBrowserInfo().then(() => {
                    log.info(`start backend service on port ${port}. pwd ${pwd}`);
                    communicate("web-server", {addr: `127.0.0.1:${port}`, port, pwd}).then(function(r){
                        if(r.Serverstate != "ok"){ 
                            log.error(`failed to start backend service: ${r.Error}`);
                            web_status = "error";
                            if(try_times == 0){
                                web_status = "failed";
                                var ms = "start web server: too many times tried";
                                reject(Error(ms));
                                log.error(ms);
                            }
                            return startWebServer(try_times - 1, debug);
                        }else{
                            showInfo(r);
                            resolve();
                        }
                    }).catch((e)=>{
                        log.error(e.message);
                        web_status = "failed";
                        reject(e);
                    });
                })
            }
        });
    })
};
browser.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if(request.type == 'START_WEB_SERVER_REQUEST'){
        if(request.force)
            web_status = "";
        return startWebServer(request.try_times, "sidebar");
    }else if(request.type == 'LOG'){
        log.sendLog(request.logtype, request.content);
    }else if(request.type == 'CLEAR_LOG'){
        __log_clear__();
    }else if(request.type == 'GET_ALL_LOG_REQUEST'){
        return Promise.resolve({logs: log_pool});
    }else if(request.type == 'GET_BACKEND_VERSION'){
        return Promise.resolve(backend_version);
    }else if(request.type == 'SAVE_BLOB_ITEM'){
        var filename = request.item.path;
        var file = request.item.blob;
        if(!file){
            return Promise.reject(Error('empty blob'));
        }else{
            return ajaxFormPost(settings.getBackendAddress() + "savebinfile", {filename, file, pwd: settings.backend_pwd});
        }
    }else if(request.type == 'DOWNLOAD_FILE'){
        var {url, itemId, filename} = request;
        return ajaxFormPost(settings.getBackendAddress() + "download", {url, itemId, filename, pwd: settings.backend_pwd});
    }else if(request.type == 'SAVE_TEXT_FILE'){
        if(request.backup){
            return new Promise((resolve, reject)=>{
                backupFile(request.path).finally(()=>{
                    saveTextFile(request).then((response)=>{
                        resolve(response);
                    }).catch(e=>{
                        reject(e);
                    });
                })
            });
        }else{
            return saveTextFile(request);
        }
    }else if(request.type == 'FS_MOVE'){
        var src = request.src, dest = request.dest;
        return ajaxFormPost(settings.getBackendAddress() + "fs/move", {src, des, pwd: settings.backend_pwd});
    }else if(request.type == 'FS_COPY'){
        var src = request.src, dest = request.dest;
        return ajaxFormPost(settings.getBackendAddress() + "fs/copy", {src, dest, pwd: settings.backend_pwd});
    }else if(request.type == 'NOTIFY'){
        return showNotification(request.message, request.title, request.notify_type);
    }else if(request.type == 'CALL_IFRAME'){
        request.type = request.action;
        return browser.tabs.sendMessage(sender.tab.id, request, {frameId: request.frameId, pwd: settings.backend_pwd});
    }else if(request.type == 'GET_IFRAMES'){
        var tabId = sender.tab.id;
        return new Promise((resolve, reject) => {
            return browser.webNavigation.getAllFrames({tabId}).then((ar)=>{
                ar.shift();
                resolve(ar);
            }).catch(e => {
                reject(e);
            });
        });
    }else if(request.type == 'INJECT_IFRAME'){
        var tabId = sender.tab.id;
        return executeScriptsInTab(tabId, [
            "/libs/mime.types.js",
            "/libs/jquery-3.3.1.js",
            "/libs/md5.js",
            "/proto.js",
            "/dialog.js",
            "/content_script.js"
        ], request.frameId);
    }else if(request.type == 'TAB_INNER_CALL'){
        return browser.tabs.sendMessage(sender.tab.id, request);
    }else if(request.type == 'IS_SIDEBAR_OPENED'){
        return browser.sidebarAction.isOpen({});
    }else if(request.type == 'GET_TAB_FAVICON'){
        return new Promise((resolve, reject) => {
            resolve(sender.tab.favIconUrl);
        });
    }else if(request.type == 'GET_SETTINGS'){
        return new Promise((resolve, reject) => {
            settings.loadFromStorage().then(()=>{
                resolve(settings);
            })
        });
    }else if(request.type == "CAPTURE_TABS"){
        browser.tabs.query({currentWindow: true}).then(function(tabs){
            for(let tab of tabs){
                var url = tab.url;
                var enabled = !(/localhost.+scrapbee/.test(url)) && (/^http(s?):/.test(url) || /^file:/.test(url));
                if(enabled)
                    sendTabContentMessage(tab, {type: 'SAVE_PAGE_REQUEST', autoClose: true}, true);
            }
        });
    }else if(request.type == "BACKUP_FILE"){
        return backupFile(request.path);
    }else if(request.type == "IS_FILE"){
        return new Promise((resolve, reject) => {
            $.post(settings.getBackendAddress() + "isfile/", {path: file, pwd: settings.backend_pwd}, function(r){
                resolve(r != "no");
            });
        });
    }else if(request.type == "DOWNLOAD_FILE"){
        return downloadFile(rquest.url);
    }
});
function saveTextFile(request){
    var filename = request.path;
    var content = request.text;
    return new Promise((resolve, reject) => {
        ajaxFormPost(settings.getBackendAddress() + "savefile", {filename, content, pwd: settings.backend_pwd}).then(response => {
            if(request.boardcast){
                browser.runtime.sendMessage({type: 'FILE_CONTENT_CHANGED', filename, srcToken:request.srcToken}).then((response) => {});
                // if(request.tab){
                //     browser.tabs.sendMessage(request.tab.id, {type: 'FILE_CONTENT_CHANGED', filename, srcToken:request.srcToken});
                // }
            }
            resolve(response);
        }).catch(error => {
            reject(error);
        });
    });
}
function backupFile(src){
    return new Promise((resolve, reject) => {
        try{
            var dest = src.replace(/([\\\/])([^\\\/]+?)(\.\w*)?$/, function(a, b, c, d){
                return b + "backup" + b + c + "_" + (new Date().format("yyyyMMdd")) + (d || "");
            })
        }catch(e){
            log.error(e.message);
        }
        $.post(settings.getBackendAddress() + "isfile/", {path: dest, pwd: settings.backend_pwd}, function(r){
            if(r == "no"){
                ajaxFormPost(settings.getBackendAddress() + "fs/copy", {src, dest, pwd: settings.backend_pwd}).then((response) => {
                    if(response == "ok"){
                        log.info(`backup success: ${dest}`);
                        resolve();
                    }else{
                        log.error(`backup failed: ${response}`);
                        reject(Error(response));
                    }
                }).catch((e) => {
                    log.error(`backup failed: ${dest}`);
                    reject(e);
                });
            }else{
                resolve();
            }
        });
    });
}
/* build menu */
browser.menus.remove("scrapbee-capture-selection");
browser.menus.remove("scrapbee-capture-page");
browser.menus.remove("scrapbee-capture-url");
browser.menus.create({
    id: "scrapbee-capture-selection",
    title: browser.i18n.getMessage("CaptureSelection"),
    contexts: ["page", "selection", "frame", "editable", "audio", "video", "link", "image", "password", "tab"],
    documentUrlPatterns: ["http://*/*", "https://*/*", "file://*/*"],
    icons: {"16": "icons/selection.svg", "32": "icons/selection.svg"},
    enabled: true,
    onclick: function(info, tab){
        browser.sidebarAction.isOpen({}).then(result => {
            if(!result){
                showNotification({message: "Please open ScrapBee in sidebar before the action", title: "Info"});
            }else{
                sendTabContentMessage(tab, {type: 'SAVE_SELECTION_REQUEST'});
            }
        });
    }
}, function(){});
browser.menus.create({
    id: "scrapbee-capture-page",
    title: browser.i18n.getMessage("CapturePage"),
    contexts: ["page", "selection", "frame", "editable", "audio", "video", "link", "image", "password", "tab"],
    documentUrlPatterns: ["http://*/*",  "https://*/*", "file://*/*"],
    icons: {"16": "icons/page.svg", "32": "icons/page.svg"},
    onclick: function(info, tab){
        // browser.sidebarAction.open()
        browser.sidebarAction.isOpen({}).then(result => {
            if(!result){
                showNotification({message: "Please open ScrapBee in sidebar before the action", title: "Info"});
            }else{
                sendTabContentMessage(tab, {type: 'SAVE_PAGE_REQUEST'});
            }
        });
    }
}, function(){});
browser.menus.create({
    id: "scrapbee-capture-url",
    title: browser.i18n.getMessage("CaptureUrl"),
    contexts: ["page", "selection", "frame", "editable", "audio", "video", "link", "image", "password", "tab"],
    documentUrlPatterns: ["http://*/*",  "https://*/*", "file://*/*"],
    icons: {"16": "icons/link.svg", "32": "icons/link.svg"},
    onclick: function(info, tab){
        browser.sidebarAction.isOpen({}).then(result => {
            if(!result){
                showNotification({message: "Please open ScrapBee in sidebar before the action", title: "Info"});
            }else{
                browser.runtime.sendMessage({type: 'SAVE_URL_REQUEST'});
            }
        });
    }
}, function(){});
browser.menus.create({
    id: "scrapbee-capture-advance",
    title: browser.i18n.getMessage("CaptureAdvance"),
    contexts: ["page", "selection", "frame", "editable", "audio", "video", "link", "image", "password", "tab"],    
    documentUrlPatterns: ["http://*/*",  "https://*/*", "file://*/*"],
    icons: {"16": "icons/advance.svg", "32": "icons/advance.svg"},
    onclick: function(info, tab){
        sendTabContentMessage(tab, {type: 'SAVE_ADVANCE_REQUEST'}).then(()=>{
        });
    }
} , function(){});
/* add-on toolbar icon */
browser.browserAction.onClicked.addListener(function(){
    // browser.sidebarAction.open()
});
// browser.browserAction.onClicked.removeListener(listener)
// browser.browserAction.onClicked.hasListener(listener)
/* update menu */
function updateMenu(url) {
    var enabled = !(/localhost.+scrapbee/.test(url)) && (/^http(s?):/.test(url) || /^file:/.test(url));
    browser.menus.update("scrapbee-capture-selection", {enabled: enabled, visible: enabled});
    browser.menus.update("scrapbee-capture-page", {enabled: enabled, visible: enabled});
    browser.menus.update("scrapbee-capture-url", {enabled: enabled, visible: enabled});
    browser.menus.update("scrapbee-capture-advance", {enabled: enabled, visible: enabled});
}
browser.tabs.onUpdated.addListener(function(tabId, changeInfo, tabInfo){
    updateMenu(tabInfo.url);
});
browser.tabs.onActivated.addListener(function(activeInfo){
    browser.tabs.get(activeInfo.tabId).then((tabInfo)=>{
        updateMenu(tabInfo.url);
    });
});
browser.tabs.onCreated.addListener(function(tabInfo){
    updateMenu(tabInfo.url);
});
// browser.browserAction.onClicked.addListener(() => {
//     browser.tabs.query({currentWindow: true, active: true}).then(function(tabs){
//         browser.tabs.executeScript(tabs[0].id, { code: 'document.contentType' }, ([ mimeType ]) => {
//             console.log(mimeType);
//         });
//     })
// });
// browser.tabs.query({currentWindow: true, active: true}).then(function(tabs){
//     var saving = browser.tabs.saveAsPDF({});
// });
