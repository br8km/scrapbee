String.prototype.htmlEncode = function(ignoreWs){
    var s = this;
    s = s.replace(/&/g,'&amp;');
    if(!ignoreWs)s = s.replace(/ /g,'&nbsp;');
    return s.replace(/</g,'&lt;')
	.replace(/>/g,'&gt;')
	.replace(/\"/g,'&quot;')
	.replace(/\'/g,'&#39;');
};
String.prototype.htmlDecode=function(){
    return this.replace(/&amp;/g,'&')
	.replace(/&quot;/g,'\"')
	.replace(/&lt;/g,'<')
	.replace(/&gt;/g,'>')
	.replace(/&nbsp;/g,' ')
	.replace(/&#39;/g,"'") ;
};
String.prototype.translate=function(){
    return this.fillData(function(s){
	try{
	    return browser.i18n.getMessage(s) || "";
	}catch(e){
	    return s;
	}
    });
};
/*
  html style escape characters
  @chars: chars be escaped
  @slashed: replace chars slashed only
*/
String.prototype.escape = function(chars, slashed) {
    return this.replace(new RegExp((slashed ? "\\\\":"") + "([" + chars + "])", "g"), function(a, b) {
        return "&#" + b.charCodeAt(0) +";";
    });
};
/* replace placeholders inside string with given data */
String.prototype.fillData = function(data) {
    /** value getter */
    function v(s){
	if(data instanceof Function){
	    return data(s);
	}
        var parts = s.split("."), d = data, r;
        for (let p of parts){
            if(p){r = d[p]; d = r;}
            if(!d) break;
        }
        return r;
    }
    var c = 1;
    /** escape slashed special characters (become normal) */
    var s = this.replace(/\{([\s\S]+)\}/g, function(a, b) {
        return "{" + b.escape("?:!", true) + "}";
    });
    /** replace all placeholder recursively */
    while(c) {
        c = 0;
        s = s.replace(/\{([^\{\}]+?)\}/g, function(match, key) { /** match placeholders */
            var m = null, r;
            if(m = key.match(/^([\s\S]+?)\!([\s\S]*?)(?:\:([\s\S]*))?$/)) { /** negative test: match [key]![true-part][:false-part] */
                r = !v(m[1]) ? m[2] : (typeof(m[3]) !="undefined" ? m[3] : "");
            } else if(m = key.match(/^([\s\S]+?)\?([\s\S]*?)(?:\:([\s\S]*))?$/)) { /** positive test: match [key]?[true-part][:false-part] */
                r = v(m[1]) ? m[2] : (typeof(m[3]) !="undefined" ? m[3] : "");
            } else { /** directly */
                var t = v(key);
                r = typeof(t) != "undefined" ? String(t).escape("?:!", false) : "";
            }
            c = 1;
            return r;
        });
    }
    return s.replace(/\&\#(\d+)\;/g, function(a, b){
        return String.fromCharCode(parseInt(b));
    });
};
String.prototype.shorten = function storten(l){
    if(this.length > l){
        return this.substring(0,l) + "...";
    }
    return this;
};
Date.prototype.format=function(fmt){
    var o={
	"M+":this.getMonth()+1,
	"d+":this.getDate(), 
	"h+":this.getHours(),
	"m+":this.getMinutes(),
	"s+":this.getSeconds(),
	"q+":Math.floor((this.getMonth()+3)/3),
	"S":this.getMilliseconds()
    };
    if(/(y+)/.test(fmt)){
	fmt=fmt.replace(RegExp.$1,(this.getFullYear()+"").substr(4-RegExp.$1.length));
    }
    for(var k in o){
	if(new RegExp("("+k+")").test(fmt)){
	    fmt=fmt.replace(RegExp.$1,(RegExp.$1.length==1)?(o[k]):(("00"+o[k]).substr((""+o[k]).length)));	
	}
    }
    return fmt;
};
String.prototype.isHexColor=function(){
    return this.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}||[0-9a-f]{8})$/i);
};
NodeList.prototype.forEach = Array.prototype.forEach;
NodeList.prototype.iterateAll = function(fn){
    this.forEach(function(item){
        fn(item);
        item.childNodes.iterateAll(fn);
    });
};

function ScrapbeeElement(el){
    this.el = el;
}
ScrapbeeElement.prototype.processResources=function(){
    this.style = window.getComputedStyle(this.el, false);
    var t = this.el.tagName.toLowerCase().replace(/^\w/, function(m){return m.toUpperCase();});
    var fn = "get" + t + "Resources";
    var res = this.getCommonResources();
    var dict = {}, r=[];
    if(this[fn] instanceof Function){
	var f = this[fn]();
	for(let s of f){
	    res.push(s);
	}
    }
    for(let re of res){
	if(!dict[re.url]){
	    dict[re.url] = 1;
	    r.push(re);
	}
    }
    return r;
}
ScrapbeeElement.prototype.getCommonResources=function(){
    var bg = this.style.backgroundImage;
    var m, r = [];
    if(m = bg.match(/^url\(['"]?(.+?)['"]?\)/)){
	var hex = hex_md5(m[1]);
        r.push({tag:this.el.tagName, type:"image", url:m[1], hex: hex});
	this.el.style.backgroundImage = "url('" + hex + "')";
    }else if(m = bg.match(/^data:image\/(.+?);base64,(.+)/)){
	var hex = hex_md5(bg);
	r.push({tag:this.el.tagName, type:"image", url:bg, hex: hex});
	this.el.style.backgroundImage = hex;
    }
    return r;
};
ScrapbeeElement.prototype.getBodyResources=function(){
    var r=[];
    if(this.el.background){
        var bg = window.getComputedStyle(document.body, null).getPropertyValue('background-image').split(/'|"/)[1];
        var hex = hex_md5(bg);
        var filename = hex;
        bg.replace(/\.\w+$/,function(a){
            filename = hex + a;
        });
	r.push({tag:this.el.tagName, type:"body", url:bg, filename});
	this.el.background = filename;
    }
    return r;
}
ScrapbeeElement.prototype.getImgResources=function(){
    var r=[];
    if(this.el.getAttribute("src")){
	var hex = hex_md5(this.el.src);
	r.push({tag:this.el.tagName, type:"image", url:this.el.src, hex:hex});
	this.el.src = hex;
    }
    return r;
};
ScrapbeeElement.prototype.getScriptResources=function(){
    this.el.setAttribute("mark_remove", "1");
    return [];
};
ScrapbeeElement.prototype.getStyleResources=function(){
    this.el.setAttribute("mark_remove", "1");
    return [];
};
ScrapbeeElement.prototype.getLinkResources=function(){
    this.el.setAttribute("mark_remove", "1");
    var r=[];
    if(this.el.rel=="shortcut icon"){
	r.push({tag:this.el.tagName, type:"image", url:this.el.href, filename:"favicon.ico"});
	this.el.href="favicon.ico";
    }else{
	this.el.href="";
    }
    return r;
};
ScrapbeeElement.prototype.getIframeResources=function(){
    this.el.setAttribute("mark_remove", "1");
    return [];
};
ScrapbeeElement.prototype.getBaseResources=function(){
    this.el.setAttribute("mark_remove", "1");
    return [];
};

true;
