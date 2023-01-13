// The code below is in charge of keeping the background script alive to update the badge and refresh the page on time.
const onUpdate = (tabId, info, tab) => /^https?:/.test(info.url) && findTab([tab]);
findTab();
chrome.runtime.onConnect.addListener(port => {
    if (port.name === 'keepAlive') {
        setTimeout(() => port.disconnect(), 250e3);
        port.onDisconnect.addListener(() => findTab());
    }
});
async function findTab(tabs) {
    if (chrome.runtime.lastError) { /* tab was closed before setTimeout ran */ }
    for (const { id: tabId } of tabs || await chrome.tabs.query({ url: '*://*/*' })) {
        try {
            await chrome.scripting.executeScript({ target: { tabId }, func: connect });
            chrome.tabs.onUpdated.removeListener(onUpdate);
            return;
        } catch (e) { }
    }
    chrome.tabs.onUpdated.addListener(onUpdate);
}
function connect() {
    chrome.runtime.connect({ name: 'keepAlive' }).onDisconnect.addListener(connect);
}
// end of background keepAlive code



const delay = ms => new Promise(resolve => setTimeout(resolve, ms));


const currentTabs = {};

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
        return sendResponse(currentTabs[req.tab.id] == undefined ? false : currentTabs[req.tab.id].isActive);
    }

    sendResponse({});
});


async function updateUIState(tabId) {

    if (!currentTabs[tabId].ui_state) currentTabs[tabId].ui_state = {
        badgeText: '',
        icon: 'inactive'
    }

    const currentState = currentTabs[tabId].ui_state;

    const newState = {}

    if (currentTabs[tabId].isActive) {
        let timeLeft = Math.ceil((currentTabs[tabId].nextRefresh - Date.now()) / 1000);
        if (currentTabs[tabId].interval < 1000 && timeLeft == 1) timeLeft = currentTabs[tabId].interval / 1000;
        newState.icon = 'active';
        newState.badgeText = timeLeft.toString();
    } else {
        newState.icon = 'inactive';
        newState.badgeText = '';
    }

    if (currentState.badgeText != newState.badgeText && currentState.badgeText != '0') {
        await chrome.action.setBadgeText({
            tabId: tabId,
            text: newState.badgeText
        });

        console.log('Set badge text:', newState.badgeText)
    }

    if (currentState.icon != newState.icon) {
        await chrome.action.setIcon({
            tabId: tabId,
            path: `/icons/icon-${newState.icon}.png`
        });

        console.log('Set icon:', newState.icon);
    }

    currentTabs[tabId].ui_state = newState;
}

async function refreshTab(tabId) {
    let resolved = false; // whether the promise has been resolved
    const promise = new Promise(async (resolve, reject) => {

        currentTabs[tabId].refreshCallback = function () {
            resolved = true;
            delete currentTabs[tabId].ui_state;
            resolve();
        }
    });

    const tab = await chrome.tabs.get(tabId);

    // only refresh if the tab is steady / not loading
    if (tab.status == 'complete') {
        await chrome.tabs.reload(tabId);
    }

    (async () => { // this is a fallback in case the callback isn't called (this can be the case if the refresh was manually canceled by a user)
        while (!resolved) {
            const tab = await chrome.tabs.get(tabId);

            console.log('tab status2:', tab.status);

            if (tab.status == 'complete' && !resolved && currentTabs[tabId].refreshCallback) {
                currentTabs[tabId].refreshCallback();
                break;
            }

            await delay(500);
        }
    })();

    return promise;
}


async function startRefresh(tab, interval) {
    const tabId = tab.id;

    //stopRefresh(tabId);

    currentTabs[tabId] = {
        interval: interval,
        nextRefresh: Date.now() + interval,
        isActive: true
    }

    while (currentTabs[tabId] && currentTabs[tabId].isActive) {
        await updateUIState(tabId);
        if (currentTabs[tabId].nextRefresh < Date.now()) {
            try {
                await refreshTab(tabId);
            } catch (e) {
                console.log('ERROR REFRESHING TAB:', e);
                return delete currentTabs[tabId];//currentTabs[tabId].isActive = false;
            }

            currentTabs[tabId].nextRefresh = Date.now() + interval;
        }
        await updateUIState(tabId);

        await delay(Math.min(interval, 1000));
    }
}

function getRefreshTime(tabId) {
    if (currentTabs[tabId] == undefined) return 5;

    return currentTabs[tabId].interval / 1000;
}

function stopRefresh(tabId) {
    if (!currentTabs[tabId]) return;

    currentTabs[tabId].isActive = false;

    updateUIState(tabId);

    currentTabs[tabId] = {
        interval: currentTabs[tabId].interval, // keep the interval in case the user clicks into the extension again, so they can see the time they set
    }

    return;
}


chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (!changeInfo || !currentTabs[tabId]) return;

    if (changeInfo.status == "complete" && currentTabs[tabId].refreshCallback) {
        currentTabs[tabId].refreshCallback();
    }
});