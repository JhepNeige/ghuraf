const net = require('net');


//websockmini
function wsm_handshake(s, data) {
	try {
		var secWsKey = String(data).match(/Sec-WebSocket-Key: (.+)\r\n/)[1];
	}catch(e){
		s.flag=2;
		return 1;
	}
//console.log(String(data),"'"+secWsKey+"'");
	var hash = require('crypto')
				 .createHash('SHA1')
				 .update(secWsKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
				 .digest('base64');
	var handshake = "HTTP/1.1 101 Switching Protocols\r\n"+//"HTTP/1.1 101 Web Socket Protocol Handshake\r\n" +
				"Upgrade: WebSocket\r\n" +
				"Connection: Upgrade\r\n" +
				"Sec-WebSocket-Accept: " + hash + "\r\n" +
				//"Content-Encoding: gzip;q=0,deflate,sdch\r\n" +
				"\r\n";
	s.write(handshake);
	s.flag=1;
	return 0;
}

function wsm_parse(s, data) {
	var frm = {	fin  	:Boolean(data[0] & 0b10000000),
				rsv1 	:Boolean(data[0] & 0b01000000),
				rsv2 	:Boolean(data[0] & 0b00100000),
				rsv3 	:Boolean(data[0] & 0b00010000),
				opcode  :data[0] & 0b00001111,
				mask 	:Boolean(data[1] & 0b10000000),
				paylen  :data[1] & 0b01111111};

	if (frm.opcode==8) {/*console.log("Close ctrl frame recieved from"+s.id);*/ s.end(); return null; }
	if (frm.opcode!=1) return null;
	var ofs=2;
	if(frm.paylen>125) {
		if (frm.paylen==127) {frm.len=data.readInt64BE(ofs); ofs+=8;}
		else {frm.len=data.readInt16BE(ofs); ofs+=2;}
	} else frm.len=frm.paylen;
	if (frm.mask) {
		frm.mk=data.slice(ofs,ofs+4);
		ofs+=4;
		data=data.slice(ofs,ofs+frm.len);
		for (var i=0;i<data.length;++i) data[i]=data[i] ^ frm.mk[i % 4];
		data=data.toString('utf8');
	} else {
		data=data.slice(ofs).toString('utf8');
	}
//console.log("string payload:\n",data);
	return data;
}
function wsm_write(s, a) {
console.log("write:",a);
	if (s.flag==2){s.write(a); return 0;}
	a=Buffer.from(a);
	var len=a.length;
	var frm =Buffer.alloc(8), ofs=0;
	frm.writeUInt8(0b10000001, 0); ++ofs; //fin+opcode=1
	if (len>125) {
		if (len>0xffff) {
			frm.writeUInt8(127, ofs); ++ofs;
			frm.writeUInt64BE(len, ofs); ofs+=8;
		} else {
			frm.writeUInt8(126, ofs); ++ofs;
			frm.writeUInt16BE(len, ofs); ofs+=2; 
		}
	} else {frm.writeUInt8(len, ofs); ++ofs;}
	frm=frm.slice(0,ofs);
	frm=Buffer.concat([frm,a]);
	s.write(frm,'binary');
	return 0;
}
// FIN websockmini

function TypeName(a) {
	if (!a) return "null";
	return a.constructor.toString().match(/function (.+)\(/)[1];
}

function getkey() {
	function r(){var i=Math.floor(Math.random()*62);return String.fromCharCode(48+i+(i>9)*7+(i>35)*6);}
	return r()+r()+r()+r()+r();
}

function Message(frm,type,data){
	var a=this;
	if (frm instanceof net.Socket)frm=frm.alias;
	var msg={'message':type,'from':frm};
	if (data) Object.assign(msg,data);
	if (!(a instanceof Array)) a=[a];
	for (let x of a) {
		if (!(x instanceof net.Socket)) x=alias[x];
		wsm_write(x, JSON.stringify(msg));
	}
}



var clients=[];
Object.defineProperty(clients, "msg",{value:Message});
var alias={};
Object.defineProperty(alias, "get_new", {value(s){
	var a=getkey();
	s.alias=a;
	this[a]=s;
	return a;
}});
var rooms={};
Array.remove = function (arg,obj,prop) {
	obj[prop]=obj[prop].filter(x=>arg!=x);
}

var port =process.env.PORT || 5000


var server = net.createServer(function (s) {
	s.id=s.remoteAddress; if (s.id.indexOf(":")!=-1) s.id="["+s.id+"]";/*IPv6*/	s.id=s.id+":"+s.remotePort;
	clients.push(s);
	Object.defineProperty(s, 'flag', {
		set(a){
			if (this._flag==a) return;
			this._flag=a;
			if (a>0) {
				// at connection establishment
				s.msg('sys',"welcome",{you:al});
			}
		},
		get(){
			return this._flag;
		}
	});
	s.flag=0;
	setTimeout(x=>{if (s.flag==0)s.flag=2;},1000);
	s.msg=Message;
	s.inrooms=[];
	var al=alias.get_new(s);
	// Recieve data
	s.on('data', function(data) {
		if (s.flag==0){if (!wsm_handshake(s, data)) return 0;}
		if (s.flag==1) data=wsm_parse(s, data);
		if (s.flag==2) data=data.toString();
		if (!data) return 0;
		setTimeout(x=>process(data),100);
	});
	function process(data) {
console.log(">>>",data);
		try {
			var obj=JSON.parse(data);
		} catch(e) {
			s.msg('sys','err',{desc:"Err: No JSON."}); return -1;
		}
		if (!obj.query ||typeof obj.query!='string') { s.msg('sys','err',{desc:"Err: No query."}); return -1; }
		obj.query=obj.query.toLowerCase();
		if (obj.query in ["close_room","msg_room","join_room","leave_room","get_room","msg_owner","msg_room"]) {
		    if (!obj.id) {s.msg('sys','err',{desc:"Err: Room id?"}); return -1;}
			if (!rooms[obj.id]) {s.msg('sys','err',{desc:"Err: No such room"}); return -1;}
		}
		var ret,r,i;
		switch (obj.query) {
		  case "description":
			s.desc=obj.desc;
			break;
		  case "list_rooms":
			ret={};
			for (i in rooms) if (!rooms[i].hidden)ret[i]=rooms[i];
		    s.msg('sys','rooms',{'list':ret});
			break;
		  case "make_room":
		    if (!obj.name) {s.msg('sys','err',{desc:"Err: Room name?"}); return -1;}
			if (!obj.icon) {s.msg('sys','err',{desc:"Err: Room icon?"}); return -1;}
			if (s.myroom) { s.msg('sys','err',{desc:"Err: Already got a room"}); return -1; }
			let rid=getkey();
			r=rooms[rid]={'id':rid,'name':obj.name,'icon':obj.icon,p:[al],'owner':al}; //TODO make a class
			Object.defineProperty(r, "close",{value(arg) {
				delete rooms[this.id];
				clients.msg(arg,"notif:room_close",{id:this.id});
				clients.forEach(x=>Array.remove(this,x,'inrooms'));
			}});
			Object.defineProperty(r, "leave",{value(arg)  {
				if ((i=this.p.indexOf(arg.alias))==-1) throw "wrong leaving";
				this.p.splice(i,1);
				this.p.msg(arg,"notif:left",{'room':this.id});
				Array.remove(this,arg,'inrooms')
			}});
			Object.defineProperty(r.p, "msg",{value:Message});
			s.myroom=r;
			clients.msg(s,"notif:new_room",{room:r});
			break;
		  case "close_room":
			if (rooms[obj.id].owner!=al) {s.msg('sys','err',{desc:"Err: Forbidden"}); return -1;}
			rooms[obj.id].close(s);
			break;
		  case "msg_room":
		    if (!obj.data) {s.msg('sys','err',{desc:"Err: Data?"}); return -1;}
			rooms[obj.id].p.msg(s, "data", {'data':obj.data}); // add argument so msg dont echo
			break;
		  case "join_room":
			r=rooms[obj.id];
			if (r.p.indexOf(al)>-1) {s.msg('sys','err',{desc:"Err: Unable to join twice"}); return -1;}
			r.p.push(al);
			r.p.msg(s,"notif:joined",{'room':r.id,'desc':s.desc});
			s.inrooms.push(r);
			break;
		  case "leave_room":
			r=rooms[obj.id];
			if (r.p.indexOf(al)==-1) {s.msg('sys','err',{desc:"Err: Not in room "+obj.id}); return -1;}
			r.leave();
			break;
		  case "get_room":
			r=rooms[obj.id];
			ret={};
			Object.assign(ret,r);
			ret.p={};
			for(let x of r.p)ret.p[x]=alias[x].desc;
			s.msg('sys',"room", ret);
			break;
		  case "msg_owner":
			if (!obj.data) {s.msg('sys','err',{desc:"Err: Data?"}); return -1;}
			alias[rooms[obj.id].owner].msg(s,"data",{'data':obj.data}); // shouldn't we just pass obj.data ?
			break;
		  case "msg_peer":
			if (!obj.id) {s.msg('sys','err',{desc:"Err: Peer id?"}); return -1;}
			if (!alias[obj.id]) {s.msg('sys','err',{desc:"Err: No such peer"}); return -1;}
			if (!obj.data) {s.msg('sys','err',{desc:"Err: Data?"}); return -1;}
			alias[obj.id].msg(s,"data",{data:obj.data});
			break;
		  default:
			s.msg('sys','err',{desc:"Err: Unknown query."});
		}
	}
	var end = function(data) {
		let i;
		console.log("end",s.id);
		while(s.inrooms.length>0) s.inrooms[0].leave(s);
		delete alias[al];
		if ((i=clients.indexOf(s))>-1)clients.splice(i,1); // cant use filter => preserve .msg
		if (s.myroom) s.myroom.close(s);
		s.destroy();
	} ;
	s.on('close',end);
	s.on('error',end);
}).listen(port);
console.log("online",port);

