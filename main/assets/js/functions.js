function getCurrentTab() {
    return new Promise((resolve, reject) => {
        try {
            chrome.tabs.query({
                active: true,
            }, function (tabs) {
                resolve(tabs[0]);
            });
        } catch (e) {
            reject(e);
        }
    });
}

/*function refreshTab(tabId) {
    return new Promise((resolve, reject) => {
        try {
            chrome.tabs.reload(tabId, function(){
				if (chrome.runtime.lastError) {
					//console.log(chrome.runtime.lastError.message);
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
}*/