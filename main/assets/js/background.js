tabIntervals = {};

let getIntervalTime = (() => { //allows us to get the remaining time in an interval
    let _setInterval = setInterval, // Reference to the original setInterval
    intervalMap = {}; // intervalMap of all Intervals with their end times

    setInterval = (callback, delay) => { // Modify setInterval
        let id = _setInterval(function () {
            if (typeof callback == "function") {
                callback();
            }
            intervalMap[id] = Date.now() + delay; // Store the end time
        }, delay); // Run the original, and store the id

        intervalMap[id] = Date.now() + delay; // Store the end time
        return id; // Return the id
    };

    return (id) => { // The actual getInterval function
        // If there was no Interval with that id, return NaN, otherwise, return the time left clamped to 0
        return intervalMap[id] ? Math.max(intervalMap[id] - Date.now(), 0) : NaN;
    }
})();

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
                if (chrome.runtime.lastError) {
                    reject(false);
                    return;
                }
                resolve(tab);
            });
        } catch (e) {
            reject(e);
        }
    });
}

function startRefresh(tab, interval) {
    var tabId = tab.id;
    let intervalSec = Math.round(interval / 1000);
    stopRefresh(tabId);
    tabIntervals[tabId] = {};
    tabIntervals[tabId]['intervalTime'] = interval / 1000;

    refreshTab(tabId); //start it off
    const badgeInterval = setInterval(function () {
        if (tabIntervals[tabId] == undefined) {
            clearInterval(badgeInterval);
            return;
        }
        const intervalSecLeft = Math.round(getIntervalTime(tabIntervals[tabId]['interval']) / 1000);
        chrome.tabs.get(tabId, function () {
            if (chrome.runtime.lastError)
                return;
            chrome.action.setBadgeText({
                tabId: tabId,
                text: intervalSecLeft.toString()
            });
        });

        if (intervalSecLeft < 1) {
            clearInterval(badgeInterval);
        }
    }, 950);

    tabIntervals[tabId]['running'] = false; //this ensures the miniLoop ends as soon as the user ends the timer
    tabIntervals[tabId]['interval'] = setInterval(async function () {
        try {
            if (tabIntervals[tabId]['running']) {
                return;
            }
            tabIntervals[tabId]['running'] = true;
            const tab = await getTab(tabId);
            if (tab.status != "complete") {
                const miniLoop = setInterval(async function () { //this ensures if there is a long load and it is not complete yet, then it will refresh as soon as it loads since its already over the interval time
                    const tab = await getTab(tabId);
                    if (tab.status == "complete") {
                        await refreshTab(tabId);
                        clearInterval(miniLoop);
                        if (tabIntervals[tabId] != undefined) {
                            tabIntervals[tabId]['running'] = false;
                        }
                    }
                }, 50);
            } else {
                await refreshTab(tabId);
                tabIntervals[tabId]['running'] = false;
            }
            if (intervalSec > 1) {
                const badgeInterval = setInterval(function () {
                    if (tabIntervals[tabId] == undefined) {
                        clearInterval(badgeInterval);
                        return;
                    }
                    const intervalSecLeft = Math.round(getIntervalTime(tabIntervals[tabId]['interval']) / 1000);
                    chrome.tabs.get(tabId, function () {
                        if (chrome.runtime.lastError)
                            return;
                        chrome.action.setBadgeText({
                            tabId: tabId,
                            text: intervalSecLeft.toString()
                        });
                    });
                    if (intervalSecLeft < 1) {
                        clearInterval(badgeInterval);
                    }
                }, 950);
            }
        } catch (e) {
            //console.log(e);
            stopRefresh(tabId);
            return;
        }
    }, interval);

    chrome.tabs.onUpdated.addListener(function (changedTabId, changeInfo, tab) {
        if (!changeInfo) {
            return;
        }
        if (changeInfo.status != "complete" && changeInfo.status != "loading") {
            return;
        }
        if (changedTabId == tabId && tabIntervals[tabId] != undefined) {
            chrome.tabs.get(tabId, function () {
                if (chrome.runtime.lastError)
                    return;
                chrome.action.setIcon({
                    tabId: tabId,
                    path: "/icons/icon-active.png"
                });
            });

        }
    });

}

function stopRefresh(tabId) {
    if (tabIntervals[tabId] == undefined || tabIntervals[tabId] == null) {}
    else {
        clearInterval(tabIntervals[tabId]['interval']);
        tabIntervals[tabId] = undefined;
        chrome.tabs.get(tabId, function () {
            if (chrome.runtime.lastError)
                return;
            chrome.action.setIcon({
                tabId: tabId,
                path: "/icons/icon-inactive.png"
            });
            chrome.action.setBadgeText({
                tabId: tabId,
                text: ""
            });
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
