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
