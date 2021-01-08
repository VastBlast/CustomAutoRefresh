tabIntervals = {};
//tabStates = {};

function refreshTab(tabId) {
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




function startRefresh(tab, interval){
	const tabId = tab.id;
	stopRefresh(tabId);
	tabIntervals[tabId] = {};
	refreshTab(tabId); //start it off
	tabIntervals[tabId]['interval'] = setInterval(async function(){
		console.log("started!");
		try{
			const tab = await getTab(tabId);
			if(tab.status != "complete"){
				const miniLoop = setInterval(async function(){ //this ensures if there is a long load and it is not complete yet, then it will refresh as soon as it loads since its already over the interval time
					const tab = await getTab(tabId);
					if(tab.status == "complete"){
						await refreshTab(tabId);
						clearInterval(miniLoop);
					}
				}, 100);
			}else{
				await refreshTab(tabId);
			}
			//console.log();
			//chrome.browserAction.setBadgeText({tabId:tabId, text:"REFRESH"});
			//chrome.browserAction.setIcon({ tabId: tabId, path: "./images/icon-active.png" });
		}catch(e){
			console.log(e);
			stopRefresh(tabId);
			return;
		}
	}, interval);
	
	chrome.tabs.onUpdated.addListener(function (changedTabId, changeInfo, tab) {
		if(changeInfo.status != "complete" && changeInfo.status != "loading"){
			return;
		}
		if(changedTabId == tabId && tabIntervals[tabId] != undefined){
			//console.log(changeInfo);
			chrome.browserAction.setIcon({ tabId: tabId, path: "./images/icon-active.png" });
		}
	});
	
	tabIntervals[tabId]['intervalTime'] = interval / 1000;
	console.log(tabIntervals[tabId]['intervalTime']);
}

function stopRefresh(tabId){
	console.log("stopped!");
	if(tabIntervals[tabId] == undefined || tabIntervals[tabId] == null){}else{
		clearInterval(tabIntervals[tabId]['interval']); 
		tabIntervals[tabId] = undefined;
		chrome.browserAction.setIcon({ tabId: tabId, path: "./images/icon-inactive.png" });
	}
}


function getRefreshTime(tabId){
	if(tabIntervals[tabId] == undefined || tabIntervals[tabId] == null){
		return 5;
	}else{
		return tabIntervals[tabId]['intervalTime'];
	}
}

/*function saveState(tabId, html){
	tabStates[tabId] = html;
}

function loadState(tabId, defaultHtml){
	if(tabStates[tabId] == undefined || tabStates[tabId] == null){
		return defaultHtml;
	}else{
		return tabStates[tabId];
	}
}*/


chrome.runtime.onMessage.addListener(function(req, sender, sendResponse) {
    //console.log(request);
    //sendResponse({ message: "Background has received that message ?" });
	if(req.cmd == "startRefresh"){
		startRefresh(req.tab, req.interval);
	}
	
	if(req.cmd == "stopRefresh"){
		stopRefresh(req.tab.id);
	}
	
	if(req.cmd == "getRefreshTime"){
		const time = getRefreshTime(req.tab.id);
		sendResponse(time);
		return;
	}
	
	if(req.cmd == "isRefreshing"){
		if(tabIntervals[req.tab.id] == undefined){
			var res = false;
		}else{
			var res = true;
		}
		sendResponse(res);
		return;
	}
	
	/*if(req.cmd == "saveState"){
		saveState(req.tab.id, req.html);
	}
	
	if(req.cmd == "loadState"){
		const html = loadState(req.tab.id, req.html);
		sendResponse({html: html});
		return;
	}*/
	
	sendResponse({});
});







