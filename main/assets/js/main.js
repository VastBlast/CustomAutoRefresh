$("#startRefresh").on("click", async function () {
    if (parseFloat($('#interval').val()) > 9999999999) {
        $('#interval').val('9999999999');
    }
    if (parseFloat($('#interval').val()) < 0.05) {
        $('#interval').val('0.05');
    }

    const interval = parseFloat($('#interval').val()) * 1000;
    if (interval > 0) {}
    else {
        return;
    }
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

$("#stopRefresh").on("click", async function () {
    const tab = await getCurrentTab();
    chrome.runtime.sendMessage({
        cmd: "stopRefresh",
        tab: tab
    }, function (res) {
        updatePopup();
        console.log(res);
    });
});

async function updatePopup() {
    const tab = await getCurrentTab();
    chrome.runtime.sendMessage({
        cmd: "getRefreshTime",
        tab: tab
    }, function (res) {
        if ($("#interval").val() == "") {
            $("#interval").val(res);
        }
    });

    chrome.runtime.sendMessage({
        cmd: "isRefreshing",
        tab: tab
    }, function (res) {
        if (res) {
            $("#startRefresh").prop("disabled", true);
            $("#interval").prop("disabled", true);
            $("#stopRefresh").prop("disabled", false);
        } else {
            $("#startRefresh").prop("disabled", false);
            $("#interval").prop("disabled", false);
            $("#stopRefresh").prop("disabled", true);
        }
    });
}

updatePopup();
