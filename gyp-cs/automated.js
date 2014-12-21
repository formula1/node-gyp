//!/usr/bin/env node

var fs = require("fs");
var path = require("path");
var lint = require("coffeelint");

//Global Aspects
var curfile = "";
var hasusrbin = false;
var req = [];
var subreq = []
var exp = [];


//Block aspects
var lastws = 0;
var lastlineisextension = false;
var currentblocktype = false;
var multi = false;
var curclass = [];

//Line Aspects
var curws = 0;
var curline = -1;


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
function addsubreq(sub,from){
  if(!(sub in subreq)){
    subreq.push([sub,from]);
  }
}


function addexport(name){
  if(exp.indexOf(name) == -1){
    exp.push(name);
  }else{
    throw_or_log("exporting the "+name+" twice");
  }
}


function walkdir(indir,outdir){
  var result = [];
  var stat = fs.statSync(indir);
  if(!stat.isDirectory()){
    if(/\.py$/.test(indir)){
      transform(indir, outdir.substring(0,outdir.length-3)+".coffee");
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
  curfile = infile;

  var file = fs.readFileSync(infile);
  file = file.toString("utf8");
  file = file.split("\n");
  var i;
  var len = file.length
  for(i=0;i<len;i++){
    curline = i;
    whitespaceparse(file.shift(),file.push.bind(file));
  }
  var name;
  while(subreq.length > 0){
    name = subreq.shift()
    file.unshift(name[0]+" = require \""+name[1]+"\" "+"."+name[0]);
  }
  while(req.length > 0){
    name = req.shift()
    file.unshift(name+" = require \""+name+"\"");
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
    m = /^(.*)\s+$/.exec(file[i]);
    if(m){
      file[i] = m[0];
    }
  }
  if(hasusrbin){
    file.unshift("//!/usr/bin/env node");
  }
  file = file.join("\n");
  curfile = outfile;
  var comperrs = [];
  try{
    comperrs = lint.lint(file);
  }catch(e){
    throw_or_log(e);
  }
  for(i in comperrs){
    curline = comperrs[i].lineNumber
    throw_or_log(comperrs[i].message);
  }
  fs.writeFileSync(outfile,file);
  curclass = [];
  lastws = "";
  curws = "";
  multi = false;
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
  m = commentpatt.multioneline.pattern.exec(temp);
  if(m){
    m.shift();
    temp = commentpatt.multioneline.transform(m);
  }else{
    m = commentpatt.multi.pattern.exec(temp);
    if(m){
      m.shift();
      temp = commentpatt.multi.transform(m);
      if(multi) return push(temp);
    }
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
    while(curws.length < tempws.length){
      if(curclass.length > 0){
        if(curws == curclass.ws){
          curclass.shift();
        }
      }
      tempws = tempws.substring(0,tempws.length-2);
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
  lastws = curws;
  /*
  if(!fe && !lastlineisextension){
    temp += ";"
  }
  */
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
    pattern:/^\s*if\s+__name__\s+==\s+("|')__main__("|')\s*\:$/,
    transform:function(groups){
      return "if not module.parent";
    }
  },
  std:{
    pattern:/^(.*)(\s+)(sys)\.(stdout|stderr)(.*)$/,
    transform:function(groups){
      return groups[0]+groups[1]+"process."+groups[3]+groups[4];
    }
  },
  platform:{
    pattern:/^(.*)(\W+)(sys.platfrom)(.*)$/,
    transform:function(groups){
      addreq("os");
      return groups[0]+groups[1]+"os.platform()"+(groups[3]||"");
    }
  },
  chdir:{
    pattern:/^(.*)(\W+)(os.chdir)(.*)$/,
    transform:function(groups){
      return groups[0]+groups[1]+"process.chdir "+(groups[3]||"");
    }
  },
  isdir:{
    pattern:/^(.*)(\s+)(os.path.isdir)(\s*)\((.*)\)(.*)$/,
    transform:function(groups){
      addreq("fs");
      var ret = groups[0]+groups[1]+"fs\n";
      ret += groups[0]+"  "+".statSync("+groups[4]+")\n"
      ret += groups[0]+"  "+".isDirectory()"+(groups[5]||"");
      return ret;
    }
  },
  concat:{
    pattern:/^(\s*)(\w+)\.extend\s*\((.*)\)(.*)$/,
    transform:function(groups){
      return groups[0]+groups[1]+" = "+groups[1]+".concat "+groups[2]+" "+(groups[3]||"");
    }
  },
  concatalt:{
    pattern:/^(\s*)(\w+)\.extend\s*\((.*)$/,
    transform:function(groups){
      return groups[0]+groups[1]+" = "+groups[1]+".concat "+(groups[3]||"");
    }
  },
  push:{
    pattern:/^(\s*)(\w+)\s*\.\s*append\s*\((.*)\)(.*)$/,
    transform:function(groups){
      return groups[0]+groups[1]+".push "+groups[2]+(groups[3]||"");
    }
  },
  ifstate:{
    pattern:/^(\s*)if\s+(.*)$/,
    transform: function(groups){
      currentblocktype = "if"
      return groups[0]+"if "+groups[1];
    }
  },
  elifstate:{
    pattern:/^(\s*)elif\s+(.*)$/,
    transform: function(groups){
      currentblocktype = "if"
      return groups[0]+"else if "+groups[1];
    }
  },
  elsestate:{
    pattern:/^(\s*)else\s*\:$/,
    transform: function(groups){
      return groups[0]+"else";
    }
  },
  forloops:{
    pattern:/^(\s*)(for)\s+(.*)$/,
    transform: function(groups){
      currentblocktype = "for";
      return groups[0]+"for "+groups[2];
    }
  },
  whileloops:{
    pattern:/^(\s*)(while)\s+(.*)$/,
    transform: function(groups){
      currentblocktype = "while";
      return groups[0]+"while "+groups[2];
    }
  },
  classstate:{
    pattern:/^(\s*)class\s+(\w+)\s*(\([A-Za-z0-9_\. ]+\))?\s*\:$/,
    transform:function(groups){
      addclass(groups[1],groups[3]);
      return groups[0]+"class "+groups[1]+" extends "+groups[2]
    }
  },
  functionstate:{
    pattern:/^(\s*)def\s+(.*)\s*\((.*)$/,
    transform: function(groups){
      currentblocktype = "args";
      var ret;
      if(/^__init__/.test(groups[1])){
        if(curclass.length === 0){
          throw_or_log("constructor with no class reference");
        }
        return groups[0]+"constructor: ("+groups[2];
      }
      if(curclass.length === 0){
        addexport(groups[1]);
      }
      return groups[0]+groups[1]+": ("+groups[2];
    }
  },
  req:{
    pattern:/^(\s*)import\s+(.*)$/,
    transform: function(groups){
      addreq(groups[1]);
      return "";
    }
  },
  subreq:{
    pattern:/^(\s*)from\s+(.*)\s+import\s+(.*)$/,
    transform: function(groups){
      addsubreq(groups[2],groups[1]);
      return "";
    }
  },
  trys:{
    pattern:/^(\s*)try\s*\:$/,
    transform: function(groups){
      return groups[0]+"try";
    }
  },
  catches:{
    pattern:/^(\s*)except(.*)\:$/,
    transform: function(groups){
      return groups[0]+"catch "+groups[1]+(groups[2]||"");
    }
  },
  finallys:{
    pattern:/^(\s*)finally\s*\:$/,
    transform: function(groups){
      return groups[0]+"finally";
    }
  },
  selfs:{
    pattern:/^(.*)(\W)self(\W)(.*)$/,
    transform: function(groups){
      if(currentblocktype == "args"){
        return groups[0]+groups[1]+groups[3];
      }
      return groups[0]+groups[1]+"@"+groups[2]+groups[3];
    }
  },
  with:{
    pattern:/^(\s*)with\s+(.*)$/,
    transform: function(groups){
      warn_or_throw("With statements are not currently supported")
      return groups[0]+groups[1]+"@"+groups[3]+groups[4];
    }
  },
  colonend:{
    pattern: /(.*)\:$/ ,
    transform: function(groups){
      if(currentblocktype){
        if(currentblocktype == "args"){
          groups[0] += " ->";
        }
        currentblocktype = false;
        return groups[0];
      }
      if(groups[0].charAt(groups[0].length-1) == ")"){
        return groups[0]+" ->"
      }
      if(groups[0].indexOf("#") !== -1){
        return groups[0];
      }
      if(/\s*".*"\s*$/.test(groups[0])){
        return groups[0]+":";
      }
      if(/\s*'.*'\s*$/.test(groups[0])){
        return groups[0]+":";
      }
      throw_or_log("\""+groups[0]+"\" isn't being processed");
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


function throw_or_log(message){
  var boldcyan = "\033[1;36m";
  var boldred = "\033[1;31m";
  var formatend = "\033[0m";
  message = boldcyan+message+boldred+"\n In File["+curfile+"] Line: "+(curline+1)+formatend;
  if(!process.env.force){
    throw new Error(message);
  }else{
    console.error(message);
  }
}

function warn_or_throw(message){
  var boldcyan = "\033[1;36m";
  var boldorange = "\033[1;93m";
  var formatend = "\033[0m";
  message = boldcyan+message+boldorange+"\n In File["+curfile+"] Line: "+(curline+1)+formatend;
  if(process.env.sensitive){
    throw new Error(message);
  }else{
    console.warn(message);
  }
}


if(!module.parent) {
  console.log(
    "\033[47;30m"+
    "==================================="+
    "\033[0m"
  );
  console.log(
    "\033[1;93m"+
    "Starting Python to CoffeeScript"+
    "\033[0m"
  )
  console.log(
    "\033[47;30m"+
    "==================================="+
    "\033[0m"
  );

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
