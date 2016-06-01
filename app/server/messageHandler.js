var  connectedPeers = {};
function onMessage(ws, message){
    var type = message.type;
    switch (type) {
        case "ICECandidate":
            onICECandidate(message.ICECandidate, message.destination, ws.id);
            break;
        case "offer":
            onOffer(message.offer, message.destination, ws.id);
            break;
        case "answer":
            onAnswer(message.answer, message.destination, ws.id);
            break;
        case "init":
            onInit(ws, message.init);
            break;
        default:
            throw new Error("invalid message type");
    }
}

function checkForDisconnectedClients() {
    for (var p in connectedPeers){
        if (connectedPeers[p] && connectedPeers[p].readyState === 3) {
            delete connectedPeers[p];
        }
    }
}

function onInit(ws, id){
    checkForDisconnectedClients();
    console.log("init from peer:", id);
    ws.id = id;
    var list = [];
    for (var p in connectedPeers){
        list.push(p);
    }
    ws.send(JSON.stringify({
        type: 'peerlist',
        list: list
    }));
    connectedPeers[id] = ws;
}

function onOffer(offer, destination, source){
    console.log("offer from peer:", source, "to peer", destination);
    connectedPeers[destination].send(JSON.stringify({
        type:'offer',
        offer:offer,
        source:source
    }));
}

function onAnswer(answer, destination, source){
    console.log("answer from peer:", source, "to peer", destination);
    connectedPeers[destination].send(JSON.stringify({
        type: 'answer',
        answer: answer,
        source: source
    }));
}

function onICECandidate(ICECandidate, destination, source){
    console.log("ICECandidate from peer:", source, "to peer", destination);
    connectedPeers[destination].send(JSON.stringify({
        type: 'ICECandidate',
        ICECandidate: ICECandidate,
        source: source
    }));
}

module.exports = onMessage;

//exporting for unit tests only
module.exports._connectedPeers = connectedPeers;
