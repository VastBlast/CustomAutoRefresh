function getCurrentTab() {
    return new Promise((resolve, reject) => {
        try {
            chrome.tabs.query({
                active: true,
                currentWindow: true,
            }, function (tabs) {
                resolve(tabs[0]);
            });
        } catch (e) {
            reject(e);
        }
    });
}

function activateListeners() {
    document.getElementById("startRefresh").addEventListener("click", async function () {
        if (parseFloat(document.getElementById('interval').value) > 9999999999) {
            document.getElementById('interval').value = '9999999999';
        }
        if (parseFloat(document.getElementById('interval').value) < 0.05) {
            document.getElementById('interval').value = '0.05';
        }

        const interval = parseFloat(document.getElementById('interval').value) * 1000;
        if (!(interval > 0)) return;

        const tab = await getCurrentTab();
        chrome.runtime.sendMessage({
            cmd: "startRefresh",
            tab: tab,
            interval: interval
        }, function (res) {
            updatePopup();
            console.log(res);
        });
    });

    document.getElementById("stopRefresh").addEventListener("click", async function () {
        const tab = await getCurrentTab();
        chrome.runtime.sendMessage({
            cmd: "stopRefresh",
            tab: tab
        }, function (res) {
            updatePopup();
            console.log(res);
        });
    });
}

async function updatePopup() {
    const tab = await getCurrentTab();
    chrome.runtime.sendMessage({
        cmd: "getRefreshTime",
        tab: tab
    }, function (res) {
        if (document.getElementById("interval").value == "") {
            document.getElementById("interval").value = res;
        }
    });

    chrome.runtime.sendMessage({
        cmd: "isRefreshing",
        tab: tab
    }, function (res) {
        if (res) {
            document.getElementById("startRefresh").disabled = true;
            document.getElementById("interval").disabled = true;
            document.getElementById("stopRefresh").disabled = false;
        } else {
            document.getElementById("startRefresh").disabled = false;
            document.getElementById("interval").disabled = false;
            document.getElementById("stopRefresh").disabled = true;
        }
    });
}


document.addEventListener('DOMContentLoaded', function () {
    activateListeners();
    updatePopup();
    document.getElementById("interval").focus();
}, false);