tabIntervals = {};

function refreshTab(tabId) {
    return new Promise((resolve, reject) => {
        try {
            chrome.tabs.reload(tabId, function () {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError.message);
                } else {
                    // Tab exists
                    resolve(true);
                }
            });

        } catch (e) {
            reject(e);
        }
    });
}

function getTab(tabId) {
    return new Promise((resolve, reject) => {
        try {
            chrome.tabs.get(tabId, function (tab) {
                resolve(tab);
            });
        } catch (e) {
            reject(e);
        }
    });
}

function startRefresh(tab, interval) {
    const tabId = tab.id;
    stopRefresh(tabId);
    tabIntervals[tabId] = {};
    refreshTab(tabId); //start it off
    tabIntervals[tabId]['interval'] = setInterval(async function () {
        try {
            const tab = await getTab(tabId);
            if (tab.status != "complete") {
                const miniLoop = setInterval(async function () { //this ensures if there is a long load and it is not complete yet, then it will refresh as soon as it loads since its already over the interval time
                    const tab = await getTab(tabId);
                    if (tab.status == "complete") {
                        await refreshTab(tabId);
                        clearInterval(miniLoop);
                    }
                }, 100);
            } else {
                await refreshTab(tabId);
            }
            //chrome.browserAction.setBadgeText({tabId:tabId, text:"REFRESH"});
        } catch (e) {
            console.log(e);
            stopRefresh(tabId);
            return;
        }
    }, interval);

    chrome.tabs.onUpdated.addListener(function (changedTabId, changeInfo, tab) {
        if (changeInfo.status != "complete" && changeInfo.status != "loading") {
            return;
        }
        if (changedTabId == tabId && tabIntervals[tabId] != undefined) {
            chrome.browserAction.setIcon({
                tabId: tabId,
                path: "./icons/icon-active.png"
            });
        }
    });

    tabIntervals[tabId]['intervalTime'] = interval / 1000;
}

function stopRefresh(tabId) {
    if (tabIntervals[tabId] == undefined || tabIntervals[tabId] == null) {}
    else {
        clearInterval(tabIntervals[tabId]['interval']);
        tabIntervals[tabId] = undefined;
        chrome.browserAction.setIcon({
            tabId: tabId,
            path: "./icons/icon-inactive.png"
        });
    }
}

function getRefreshTime(tabId) {
    if (tabIntervals[tabId] == undefined || tabIntervals[tabId] == null) {
        return 5;
    } else {
        return tabIntervals[tabId]['intervalTime'];
    }
}

chrome.runtime.onMessage.addListener(function (req, sender, sendResponse) {
    //sendResponse({ message: "Background has received that message ?" });
    if (req.cmd == "startRefresh") {
        startRefresh(req.tab, req.interval);
    }

    if (req.cmd == "stopRefresh") {
        stopRefresh(req.tab.id);
    }

    if (req.cmd == "getRefreshTime") {
        const time = getRefreshTime(req.tab.id);
        sendResponse(time);
        return;
    }

    if (req.cmd == "isRefreshing") {
        if (tabIntervals[req.tab.id] == undefined) {
            var res = false;
        } else {
            var res = true;
        }
        sendResponse(res);
        return;
    }

    sendResponse({});
});
