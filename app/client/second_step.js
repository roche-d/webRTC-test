/**
 * Created by roche_d on 02/06/16.
 */
var RTCSessionDescription = window.RTCSessionDescription || window.mozRTCSessionDescription;
var RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
var RTCIceCandidate = window.RTCIceCandidate || window.mozRTCIceCandidate;

var wsUri = "ws://localhost:8090/";
var servers = {iceServers: [{urls: "stun:stun.1.google.com:19302"}]};

function Peer(peerId){
    this.peerId = peerId;
    this.connection = undefined;
    this.channel = undefined;
    var self = this;

    // Setup the data channel for the peer
    this._initChannel = function(channel){
        channel.onclose = function(evt){
            self.onCommunicationClose();
        };
        channel.onerror = function(evt){

        };
        channel.onopen = function(){
            self.onCommunicationOpen();
        };
        channel.onmessage = function(message){
            if (message.data){
                self.onMessage(message.data);
            }
        };
        self.channel = channel;
    };

    // Setup the connection. Must be called or the connection must be set manually.
    this.initConnection = function(){
        var connection = new RTCPeerConnection(servers, {
            optional: [{
                DtlsSrtpKeyAgreement: true
            }]
        });
        connection.onicecandidate = function(evt){
            if (evt.candidate){
                self.onIceCandidate(evt.candidate, self.peerId);
            }
        };
        connection.ondatachannel = function(event){
            if (event.channel){
                self._initChannel(event.channel);
            }
        };
        this.connection = connection;
    };

    // Override this handler to get local ICECandidate (send it through your signalingChannel)
    this.onIceCandidate = function(ICECandidate, source){
        console.log('Default Handler for Peer.onIceCandidate called', this.peerId);
    };

    // Call this function when you receive the ICECandidate of your remote peer
    this.setRemoteIceCandidate = function(ICECandidate){
        if (!this.connection) throw 'The connection of the channel was not initialized !';
        self.connection.addIceCandidate(new RTCIceCandidate(ICECandidate));
    };

    // Call this when you get an answer for this peer on your signalingChannel
    this.setAnswer = function(answer){
        self.connection.setRemoteDescription(new RTCSessionDescription(answer));
    };

    // Override this handler, called when the data channel is opened
    this.onCommunicationOpen = function(){
        console.log('Default Handler for Peer.onCommunicationOpen called', this.peerId);
    };

    // Override this handler, called when the data channel is closed
    this.onCommunicationClose = function(){
        console.log('Default Handler for Peer.onCommunicationClose called', this.peerId);
    };

    // Override this handler, called when the data channel receives a message
    this.onMessage = function(message){
        console.log('Default Handler for Peer.onMessage called', this.peerId);
    };

    // Call this function when you receive an offer from your remote peer. Answer will be called.
    this.receiveConnection = function(offer, answerCallback){
        if (!this.connection) throw 'The connection of the channel was not initialized !';
        self.connection.setRemoteDescription(new RTCSessionDescription(offer)).then(function(){
            return self.connection.createAnswer().then(function(answer){
                return self.connection.setLocalDescription(answer).then(function(){
                    answerCallback(answer, self.peerId);
                })
            })
        }).catch(function(e){console.error(e);});
    };

    // Create the offer and call the callback (send the offer through the signaling channel then)
    this.connectToPeer = function(offerCallback){
        var chan = this.connection.createDataChannel('communication', {
            reliable: false
        });
        this._initChannel(chan);
        this.connection.createOffer(function(offer){
            self.connection.setLocalDescription(offer);
            offerCallback(offer);
        }, function(e){
            console.error(e);
        });
    };

    // Send a message to the peer
    this.send = function(message){
        if (!this.channel) throw 'The channel is not ready to send messages !';
        this.channel.send(JSON.stringify(message));
    };

    // Proxy a message
    this.proxy = function(to, message){
        this.send({
            type: 'proxy',
            destination: to,
            message: message
        });
    }
}

var createPeer = function(peerId){
    var peer = new Peer(peerId);
    peer.initConnection();
    return peer;
};

function Client(config){
    var config = config || {};

    this.signalingChannel = createSignalingChannel(wsUri, CALLER_ID);
    this.peers = {};

    var self = this;

    this.setupSocketSignalingChannel = function(){
        var sc = self.signalingChannel;
        sc.onICECandidate = self.onIceCandidate;
        sc.onOffer = function(offer, source){
            self.onOffer(sc, offer, source);
        };
        sc.onPeerSignal = function(signal){
            if (!signal) return;

            var peer = self.setupPeer(signal, sc);
            peer.connectToPeer(function(offer){
                sc.sendOffer(offer, signal);
            });
        };
        sc.onAnswer = function(answer, source){
            self.onAnswer(sc, answer, source);
        };
    };

    // Create and set the callbacks for the Peer object
    this.setupPeer = function(peerId, signalingChannel){
        var peer = createPeer(peerId);
        peer.onIceCandidate = function(ICECandidate, destination){
            self.sendIceCandidate(signalingChannel, ICECandidate, destination);
        };
        peer.onCommunicationOpen = function(){
            var list = [];
            for (var k in self.peers){
                list.push(k);
            }
            peer.send({
                from: self.peerId,
                type: 'peerlist',
                list: list
            });
            if (config.newPeerCallback) config.newPeerCallback(peerId);
        };
        peer.onCommunicationClose = function(){
            if (config.peerDisconnectedCallback) config.peerDisconnectedCallback(peerId);
            if (self.peers[peerId]) delete self.peers[peerId];
        };
        peer.onMessage = function(message){
            var content = JSON.parse(message);
            switch (content.type){
                case 'proxy':
                    if (content.destination && self.peers[content.destination]) {
                        self.peers[content.destination].send(content.message);
                    } else throw 'Unable to proxy message to ' + content.destination;
                    break;
                case 'message':
                    self.onMessage(peerId, content.message);
                    break;
                case 'peerlist':
                    content.list.forEach(function(e){
                        if (e !== CALLER_ID.toString() && !self.peers[e]){
                            // Create connection using this peer as signaling
                            var newpeer = self.setupPeer(e, peer);
                            newpeer.connectToPeer(function(offer) {
                                peer.sendOffer(offer, e);
                            });
                        }
                    });
                    break;
                case 'offer':
                    self.onOffer(peer, content.offer, content.source);
                    break;
                case 'answer':
                    self.onAnswer(peer, content.answer, content.source);
                    break;
                case 'ICECandidate':
                    self.onIceCandidate(content.ICECandidate, content.source);
                    break;
                default:
                    throw 'Unknown message type ' + content.type
            }
        };
        peer.sendOffer = function(offer, peerId){
            peer.proxy(peerId, {
                type: 'offer',
                offer: offer,
                source: CALLER_ID
            });
        };
        peer.sendICECandidate = function(ICECandidate, destination){
            peer.proxy(destination, {
                type: 'ICECandidate',
                ICECandidate: ICECandidate,
                source: CALLER_ID
            });
        };
        peer.sendAnswer = function(answer, source){
            peer.proxy(source, {
                type: 'answer',
                answer: answer,
                source: CALLER_ID
            });
        };

        self.peers[peerId] = peer;
        return peer;
    };

    this.onOffer = function(signalingChannel, offer, source){
        var peer = self.setupPeer(source, signalingChannel);
        peer.receiveConnection(offer, function(answer){
            signalingChannel.sendAnswer(answer, source);
        });
    };

    this.onAnswer = function(signalingChannel, answer, source){
        if (self.peers[source]){
            self.peers[source].setAnswer(answer);
        }
    };

    this.sendIceCandidate = function(signalingChannel, ICECandidate, destination){
        signalingChannel.sendICECandidate(ICECandidate, destination);
    };

    this.onIceCandidate = function(ICECandidate, source){
        if (self.peers[source]){
            self.peers[source].setRemoteIceCandidate(ICECandidate);
        }
    };

    this.onMessage = function(from, message){
        if (config.messageCallback) config.messageCallback(from, message);
    };

    this.sendMessage = function(peerId, message){
        var peer = this.peers[peerId];
        if (peer){
            peer.send({
                type: 'message',
                from: CALLER_ID,
                message: message
            });
        }
    };

    this.setupSocketSignalingChannel();
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

window.createClient = function(config){
    var client = new Client(config);
    return client;
};
