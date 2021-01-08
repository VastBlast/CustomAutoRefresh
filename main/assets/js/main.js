




$("#startRefresh").on("click", async function () {
	const interval = parseFloat($('#interval').val()) * 1000;
	sessionStorage.interval = 6;
	if(interval > 0){}else{
		return;
	}
	const tab = await getCurrentTab();
	chrome.runtime.sendMessage({ cmd: "startRefresh", tab: tab, interval: interval  }, function(res) {
		updatePopup();
		console.log(res);
	});
});


$("#stopRefresh").on("click", async function () {
	const tab = await getCurrentTab();
	chrome.runtime.sendMessage({ cmd: "stopRefresh", tab: tab }, function(res) {
		updatePopup();
		console.log(res);
	});
});


async function updatePopup(){
	const tab = await getCurrentTab();
	chrome.runtime.sendMessage({ cmd: "getRefreshTime", tab: tab }, function(res) {
		if($("#interval").val() == ""){
			$("#interval").val(res);
		}
	});
	
	chrome.runtime.sendMessage({ cmd: "isRefreshing", tab: tab }, function(res) {
		if(res){
			$("#startRefresh").prop("disabled", true);
			$("#stopRefresh").prop("disabled", false);
		}else{
			$("#startRefresh").prop("disabled", false);
			$("#stopRefresh").prop("disabled", true);
		}
	});
}


updatePopup();

/*
async function saveState(){
	const tab = await getCurrentTab();
	chrome.runtime.sendMessage({ cmd: "saveState", tab: tab, html: $('#interval').html() }, function(res) {
		console.log(res);
	});
}

async function loadState(){
	const tab = await getCurrentTab();
	chrome.runtime.sendMessage({ cmd: "loadState", tab: tab, html: $('#interval').html() }, function(res) {
		$('#interval').html(res.html);
	});
}

$(document).bind("click keydown keyup", saveState);

loadState();
*/


$("#test3").on("click", function () {
    const w = $("#in-width").val();
    const h = $("#in-height").val();
    $("#main").width(w);
    $("#main").height(h);
});

$("#test2").on("click", async function () {
    /*chrome.tabs.executeScript({
    //$("#test3").text("wefwef");
		//alert("y");
    });
    chrome.tabs.executeScript({
        file: './test.min.js' //runs the file on the webpage
    });*/
    //$("#ccStart").text("wefwef");
	//alert(tab.id);
	//chrome.tabs.query({active:true,windowType:"normal", currentWindow: true});
	/*const tabId = await getTabID();
	chrome.tabs.executeScript(tabId, {
		code: "alert('yooooo')"
	});*/
	
	const tab = await getCurrentTab();
	//loopAlert(tabId);
	chrome.runtime.sendMessage({ message: "supdude", tab: tab }, function(res) {
		console.log(res);
	});
	/*chrome.tabs.executeScript(tabId, {
		//code: "setInterval(function(){location.reload();},2000);"
		code: "setInterval(function(){location.reload(); console.log('reloaded!!')},1000);"
	});*/
});





$("#test1").on("click", async function () {
    //const interval = $("#interval").val();
    //chrome.browserAction.setBadgeText({text: interval});
    //chrome.tabs.reload();
    //setTimeout(function(){ chrome.tabs.reload(); }, 1000);
	//alert("sup");
    chrome.tabs.query({
        active: true,
        currentWindow: true
    }, function (tabs) {
        var currTab = tabs[0];
        if (currTab) { // Sanity check
            //do stuff
			//console.log(currTab);
			setTimeout(function(){ chrome.tabs.reload(currTab.id); }, 1000);
        }
    });
	
});
