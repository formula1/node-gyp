//!/usr/bin/env node

var fs = require("fs");
var path = require("path");
var curclass = [];
var lastws = 0;
var curws = 0;
var multi = false;
var req = [];
var exp = [];
var lastline = "";
var hasusrbin = false;
var curender = [];
var lastlineisextension = false;

function addclass(name,inherits){
  curclass.unshift({
    name:name,
    ws:curws
  });
  if(inherits){
    inherits = inherits.substring(1,inherits.length-1);
    addreq(inherits);
    curclass[0].inherits = inherits;
  }
}

function addreq(name){
  if(req.indexOf(name) == -1){
    req.push(name);
  }
}

function addexport(name){
  if(exp.indexOf(name) == -1){
    exp.push(name);
  }else{
    throw new Error("exporting the "+name+" twice");
  }
}


function walkdir(indir,outdir){
  var result = [];
  var stat = fs.statSync(indir);
  if(!stat.isDirectory()){
    if(/\.py$/.test(indir)){
      transform(indir, outdir.substring(0,outdir.length-3)+".js");
      console.log(indir+" was transformed into "+outdir);
      result.push(indir);
    }else{
      console.log(indir+" is not a python script");
      return false;
    }
  }else{
    var files = fs.readdirSync(indir);
    try{
      fs.mkdirSync(outdir);
    }catch(e){
      //for now I don't care if it already exists
    }
    for(var i = 0;i<files.length;i++){
      if(/^\..*$/.test(files[i])) continue;
      var tpath = path.join(indir,files[i]);
      var topath = path.join(outdir,files[i]);
      var check = walkdir(tpath,topath);
      if(!check){
        continue;
      }
      result = result.concat(check);
    }
  }
  result.sort();
  return result;
}

function transform(infile,outfile){
  var file = fs.readFileSync(infile);
  file = file.toString("utf8");
  file = file.split("\n");
  var i;
  var len = file.length
  for(i=0;i<len;i++){
    whitespaceparse(file.shift(),file.push.bind(file));
  }
  var name;
  while(req.length > 0){
    name = req.shift()
    file.unshift("var "+name+" = require(\""+name+"\");");
  }
  console.log(curender.length);
  while(curender.length > 0){
    lastws = lastws.substring(0,lastws.length-2);
    file.push(lastws+curender.pop());
  }
  while(exp.length > 0){
    name = exp.shift();
    file.push("module.exports."+name+" = "+name);
  }
  for(i=0;i<file.length;i++){
    if(/^\s*$/.test(file[i])){
      file.splice(i,1);
      i--;
    }
  }
  if(hasusrbin){
    file.unshift("//!/usr/bin/env node");
  }
  file = file.join("\n");
  fs.writeFileSync(outfile,file);
  curclass = [];
  curender = [];
  lastws = "";
  curws = "";
  multi = false;
  lastline = "";
  hasusrbin = false;
  file = null;
}

function whitespaceparse(line,push){
  var m;
  var i;
  var temp = line.replace("\t","    ");
  if(commentpatt.usrbin.pattern.test(temp)){
    return;
  }
  m = commentpatt.comment.pattern.exec(temp);
  if(m){
    m.shift();
    temp = commentpatt.comment.transform(m);
  }
  m = commentpatt.multioneline.pattern.exec(temp);
  if(m){
    m.shift();
    temp = commentpatt.multioneline.transform(m);
  }
  m = commentpatt.multi.pattern.exec(temp);
  if(m){
    m.shift();
    temp = commentpatt.multi.transform(m);
    if(multi) return push(temp);
  }
  if(multi){
    return;
  }
  if(/^\s*$/.test(temp)){
    return;
  }
  curws = /(^(\s\s)*).*$/.exec(temp)[1];
  var tempws = lastws;

  if(lastlineisextension){
    if(curws.length < tempws.length){
      lastlineisextension = false;
    }
  }else{
    console.log(tempws.length);
    while(curws.length < tempws.length){
      if(curclass.length > 0){
        if(curws == curclass.ws){
          curclass.shift();
        }
      }
      if(curender.length > 1){
        tempws = tempws.substring(0,tempws.length-2);
      }else{
        tempws = curws;
      }
      push(tempws+curender.pop());
    }
  }
  for(i in patterns){
    m = patterns[i].pattern.exec(temp);
    if(m){
      m.shift();
      temp = patterns[i].transform(m);
    }
    if(temp === ""){
      return;
    }
  }
  var fe = false;
  for(i in endpatt){
    if(endpatt[i].pattern.test(temp)){
      curender.push(endpatt[i].ender);
      fe = true;
      break
    }
  }
  lastws = curws;
  if(/(.*)\\(\s*\/\/.*)?$/.test(temp)){
    temp = temp.substring(0,temp.length-1);
  }
  if(/^\s*(\+|\,)/.test(temp)){
    lastlineisextension = true;
  }
  if(/(\+|\,)\s*$/.test(temp)){
    lastlineisextension = true;
  }
  /*
  if(!fe && !lastlineisextension){
    temp += ";"
  }
  */
  lastline = "";
  return push(temp);
}
var commentpatt = {
  usrbin:{
    pattern:/#\s*\!\/usr\/bin\/env\s+python/,
    transform:function(groups){
      hasusrbin = true;
      return "";
    }
  },
  comment:{
    pattern:/^(.*)\#(.*)$/,
    transform:function(groups){
      return groups[0];
    }
  },
  multioneline: {
    pattern:/^(.*)(\"\"\")(.*)(\"\"\")(.*)$/,
    transform:function(m){
      if(multi){
        line = m[2];
      }else{
        line = m[0]+m[4]
      }
    }
  },
  multi:{
    pattern:/(.*)"""(.*)/,
    transform:function(m){
      multi = !multi;
      return (multi)?m[0]:m[1];
    }
  }
}
var patterns = {
  main:{
    pattern:/^\s*if\s+__name__\s+==\s+"__main__"\s*\:$/,
    transform:function(groups){
      return "if(!module.parent) {";
    }
  },
  std:{
    pattern:/^(.*)(\s+)(sys)\.(stdout|stderr)(.*)$/,
    transform:function(groups){
      return groups[0]+groups[1]+"process."+groups[3]+groups[4];
    }
  },
  platform:{
    pattern:/^(.*)(\s+)(sys.platfrom)(.*)$/,
    transform:function(groups){
      addreq("os");
      return groups[0]+groups[1]+"os.platform()"+groups[3];
    }
  },
  chdir:{
    pattern:/^(.*)(\s+)(os.chdir)(.*)$/,
    transform:function(groups){
      return groups[0]+groups[1]+"process.chdir"+groups[3];
    }
  },
  isdir:{
    pattern:/^(.*)(\s+)(os.path.isdir)(\s*)\((.*)\)(.*)$/,
    transform:function(groups){
      return groups[0]+groups[1]+"fs.statSync("+groups[4]+").isDirectory() "+groups[5];
    }
  },
  concat:{
    pattern:/^(\s*)(\w+)(\.extend)(\s*)\((.*)\)(.*)$/,
    transform:function(groups){
      return groups[0]+groups[1]+" = "+groups[1]+".concat("+groups[4]+");"+groups[5];
    }
  },
  push:{
    pattern:/^(\s*)(\w+)(\.append)(\s*)\((.*)\)(.*)$/,
    transform:function(groups){
      return groups[0]+groups[1]+" = "+groups[1]+".push("+groups[4]+");"+groups[5];
    }
  },
  ifstate:{
    pattern:/^(\s*)if\s+(.*)\:$/,
    transform: function(groups){
      return groups[0]+"if ("+groups[1]+" ){ ";
    }
  },
  elifstate:{
    pattern:/^(\s*)elif\s+(.*)\:$/,
    transform: function(groups){
      return groups[0]+"else if ("+groups[1]+" ){ ";
    }
  },
  elsestate:{
    pattern:/^(\s*)else\s*\:$/,
    transform: function(groups){
      return groups[0]+"else { ";
    }
  },
  forloops:{
    pattern:/^(\s*)(for)(.*)(\:)$/,
    transform: function(groups){
      return groups[0]+"for ( "+groups[2]+" ){ ";
    }
  },
  whileloops:{
    pattern:/^(\s*)(while)(.*)(\:)$/,
    transform: function(groups){
      return groups[0]+"for ( "+groups[2]+" ){ ";
    }
  },
  classstate:{
    pattern:/^(\s*)(class)\s+(\w+)\s*(\(\w+\))?\s*\:$/,
    transform:function(groups){
      addclass(groups[2],groups[3]);
      if(curclass[0].inherits){
        return "util.inherits("+curclass[0].name+", "+curclass[0].inherits+");";
      }
    }
  },
  functionstate:{
    pattern:/^(\s*)(def)\s+(.*)\s*\((.*)\)?(.*)$/,
    transform: function(groups){
      var ret;
      if(curclass.length > 0){
        if(/^__init__/.test(groups[2])){
          addexport(curclass[0].name);
          ret = groups[0]+"function "+curclass[0].name;
        }else{
          ret = groups[0]+curclass[0].name+".prototype."+groups[2]+" = function ";
        }
      }else{
        addexport(groups[2]);
        ret = groups[0]+"function "+groups[2];
      }
      ret += "("+groups[3];
      return ret;
    }
  },
  not:{
    pattern:/(.*)(\s+)not(\s+)(.*)/,
    transform:function(groups){
      return groups[0]+" ! "+groups[3];
    }
  },
  req:{
    pattern:/^(\s*)import\s+(.*)$/,
    transform: function(groups){
      addreq(groups[1]);
      return "";
    }
  },
  trys:{
    pattern:/^(\s*)try\s*\:$/,
    transform: function(groups){
      return groups[0]+"try{";
    }
  },
  catches:{
    pattern:/^(\s*)except\s+(.*)\:$/,
    transform: function(groups){
      return groups[0]+"catch("+groups[1]+"){";
    }
  },
  finallys:{
    pattern:/^(\s*)finally\s*\:$/,
    transform: function(groups){
      return groups[0]+"finally{";
    }
  },
  selfs:{
    pattern:/^(.*)(\W)self(\W)(.*)$/,
    transform: function(groups){
      return groups[0]+groups[1]+"this"+groups[3]+groups[4];
    }
  },
  colonend:{
    pattern: /(.*)\:$/ ,
    transform: function(groups){
      return groups[0]+" ) {";
    }
  },
}

var endpatt = {
  squarend:{
    pattern: /\[\s*$/ ,
    ender:"]",
    transform: function(groups){
      curender.push("]");
      return groups[0]+groups[1];
    }
  },
  parenend:{
    pattern: /\(\s*$/ ,
    ender:")",
    transform: function(groups){
      curender.push(")");
      return groups[0]+groups[1];
    }
  },
  curlyend:{
    pattern: /\{\s*$/ ,
    ender:"}",
    transform: function(groups){
      curender.push("}");
      return groups[0]+groups[1];
    }
  }
}

var consolidatepatt = {
  escapeline:{
    pattern: /^(.*)\\(\s*\/\/.*)?$/ ,
    type: "appendnext",
    transform: function(groups){
      return groups[0];
    }
  },
  pluscomma:{
    pattern: /^(.*)([\+|\,])(\s*\/\/.*)?$/ ,
    type: "appendnext",
    transform: function(groups){
      return groups[0]+groups[1];
    }
  },
  startpluscomma:{
    pattern: /^\s*([\+|\,])(.*)?$/ ,
    type: "appendnext",
    transform: function(groups){
      return groups[0]+groups[1];
    }
  },
}


if(!module.parent) {
  var indir = process.env.in_dir || process.cwd();
  var outdir = process.env.out_dir || path.resolve(process.cwd(), "compjs");
  var boo = false;

  while(boo){
    try{
      boo = !fs.statSync(outdir).isDirectory();
    }catch(e){
      boo = false;
      fs.mkdirSync(outdir);
    }
  }
  walkdir(indir,outdir);
}else{
  module.exports.whitespaceparse = whitespaceparse;
  module.exports.transform = transform;
  module.exports.walkdir = walkdir;
}
  /*
  * if a string contains `%` then we have to replace that and the next character with `j`
  */
