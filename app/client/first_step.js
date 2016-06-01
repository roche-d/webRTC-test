/**
 * Created by roche_d on 01/06/16.
 */

function initClient(config){
    var config = config || {};
    var RTCSessionDescription = window.RTCSessionDescription || window.mozRTCSessionDescription;
    var RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
    var RTCIceCandidate = window.RTCIceCandidate || window.mozRTCIceCandidate;

    var wsUri = "ws://localhost:8090/";
    var signalingChannel = createSignalingChannel(wsUri, CALLER_ID);
    var servers = {iceServers: [{urls: "stun:stun.1.google.com:19302"}]};
    var peerConnections = {};
    var peerChannels = {};

    function setupChannel(channel, peerId){
        if (channel){
            channel.onclose = function(evt) {
                if (config.peerDisconnectedCallback) config.peerDisconnectedCallback(peerId);
            };

            channel.onerror = function(evt) {
                console.error("dataChannel error");
            };

            channel.onopen = function(){
                if (config.newPeerCallback) config.newPeerCallback(peerId);
            };

            channel.onmessage = function(message){
                if (config.messageCallback) config.messageCallback(JSON.parse(message.data));
            };
            window.peerChannels[peerId] = channel;
        }
    }

    function createPeerConnection(peerId){
        var pc = new RTCPeerConnection(servers, {
            optional: [{
                DtlsSrtpKeyAgreement: true
            }]
        });

        pc.onicecandidate = function (evt) {
            if(evt.candidate){ // empty candidate (wirth evt.candidate === null) are often generated
                signalingChannel.sendICECandidate(evt.candidate, peerId);
            }
        };

        signalingChannel.onICECandidate = function (ICECandidate, source) {
            pc.addIceCandidate(new RTCIceCandidate(ICECandidate));
        };

        pc.ondatachannel = function(event) {
            var receiveChannel = event.channel;
            setupChannel(receiveChannel, peerId);
        };

        return pc;
    }

    signalingChannel.onOffer = function (offer, source){

        var peerConnection = createPeerConnection(source);
        peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        peerConnection.createAnswer(function(answer){
            peerConnection.setLocalDescription(answer);
            signalingChannel.sendAnswer(answer, source);
        }, function (e){
            console.error(e);
        });
    };

    signalingChannel.onAnswer = function (answer, source) {
        if (peerConnections[source]) {
            peerConnections[source].setRemoteDescription(new RTCSessionDescription(answer))
        }
    };

    signalingChannel.onICECandidate = function (ICECandidate, source) {
        if (peerConnections[source]) {
            peerConnections[source].addIceCandidate(new RTCIceCandidate(ICECandidate));
        }
    };

    signalingChannel.onPeerList = function(list){
        if (list) {
            list.forEach(function (e) {
                startCommunication(e);
            });
        }
    };

    function startCommunication(peerId) {
        if (peerConnections[peerId]) return;

        var pc = createPeerConnection(peerId);

        //:warning the dataChannel must be opened BEFORE creating the offer.
        var _commChannel = pc.createDataChannel('communication', {
            reliable: false
        });

        setupChannel(_commChannel, peerId);

        pc.createOffer(function(offer){
            pc.setLocalDescription(offer);
            signalingChannel.sendOffer(offer, peerId);
        }, function (e){
            console.error(e);
        });

        // Save the channel and the peerConnection
        peerConnections[peerId] = pc;
    }

    window.peerConnections = peerConnections;
    window.peerChannels = peerChannels;
}

function addUserToList(user){
    if (user) {
        var newp = document.createElement('p');
        var input = document.createElement('input');
        input.type = 'radio';
        input.value = user;
        input.name = 'user';
        newp.appendChild(input);
        var content = document.createTextNode(' ' + user);
        newp.appendChild(content);
        document.getElementById('userlist').appendChild(newp);
    }
}

function removeUserFromList(user){
    if (user) {
        var element = document.querySelector('#userlist p input[value="'+ user +'"]');
        if (!element) return;
        var pElement = element.parentElement;
        pElement.parentElement.removeChild(pElement);
    }
}

function sendMsgToSelectedUser(){
    var message = document.getElementById('message').value;
    var user = (document.querySelector('input[name = "user"]:checked') || {}).value;
    if (message && user && window.peerChannels[user]) {
        window.peerChannels[user].send(JSON.stringify({
            message: message,
            from: CALLER_ID
        }));
    }
}
