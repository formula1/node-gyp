//!/usr/bin/env node

// Copyright (c) 2012 Google Inc. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

__doc__ = "gyptest.py -- test runner for GYP tests."

var os = require("os");
var path = require("path");
var child_process = require("child_process");
var fs = require("fs");
var commander = require("commander");
var async = require("async");

var python = process.env.PYTHON || 'python';

/*
Executor class for commands, including "commands" implemented by
Python functions.
*/

var STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;
var ARGUMENT_NAMES = /([^\s,]+)/g;
function getParamNames(func) {
  var fnStr = func.toString().replace(STRIP_COMMENTS, '')
  var result = fnStr.slice(fnStr.indexOf('(')+1, fnStr.indexOf(')')).match(ARGUMENT_NAMES)
  if(result === null)
    result = [];
  return result
}

function CommandRunner(dictionary){
  this.verbose = true;
  this.active = true;
  this._subst_dictionary = dictionary||[];
}

CommandRunner.prototype.subst_dictionary = function(dictionary){
  this._subst_dictionary = dictionary;
}
CommandRunner.prototype.subst = function(string,dictionary){
  if(!dictionary){
    dictionary = this._subst_dictionary;
  }
  if(dictionary){
    try{
      var pos
      while((pos=string.indexOf("%")) != -1){
        var b = string.substring(0,pos);
        var a = string.substring(pos+2);
        string = b+dictionary.pop()+a;
      }
    }catch(e){

    }
  }
  return string
}

/*
Substitutes (via the format operator) the values in the specified
dictionary into the specified command.

The command can be an (action, string) tuple.  In all cases, we
perform substitution on strings and don't worry if something isn't
a string.  (It's probably a Python function to be executed.)
*/
CommandRunner.prototype.display = function(command,stdout,stderr){
  if(!this.verbose) return;
  var s;
  if(typeof command == "function"){
    s = this.subst("%s(%s)", [command.name, getParamNames(command).join(", ")])
  }else if(typeof command == "object" && Array.isArray(command)){
    s = command.join(" ");
  }else{
    s = this.subst(command)
  }
  if(!stdout) stdout = console.log.bind(console);
  stdout(s);
}

CommandRunner.prototype.execute = function(command,stdout,stderr,next){
  /*
  Executes a single command.
  */
  var cmdargs;
  if(!this.active) return false;
  if(typeof command == "string"){
    command = self.subst(command)
    cmdargs = command.split(" ");
    if(cmdargs[0] == 'cd'){
      command = process.chdir(cmdargs[1]);
    }
  }
  if(typeof command == "function"){
    return command;
  }else{
    if(!stdout) stdout = process.stdout;
    if(!stderr) stderr = process.stderr;
    var sp = child_process.spawn(command.join(" "), []);
    sp.stdout.pipe(stdout);
    sp.stderr.pipe(stderr);
    sp.on("error",function(){
      sp.removeAllListeners("exit");
      next(1);
    });
    sp.on("exit",next.bind(next,void(0)));
  }
}

CommandRunner.prototype.run = function(command,display,stdout,stderr,next){
  /*
  Runs a single command, displaying it first.
  */
  if(!display){
    display = command
  }
  this.display(display);
  this.execute(command, stdout, stderr,next)
}



function is_test_name(f){
  return /^gyptest.*\.py$/.test(f);
}

function find_all_gyptest_files(directory){
  var result = [];
  var stat = fs.statSync(directory);
  if(!stat.isDir()){
    if(is_test_name(directory)){
      results.push(directory);
    }else{
      return false;
    }
  }else{
    var files = fs.readdirSync(directory);
    for(var i = 0;i<files.length;i++){
      if(/\.svn|\.git/.test(files[i])) continue;
      var tpath = path.join(directory,files[i]);
      var check = find_all_gyptest_files(tpath);
      if(!check) continue;
      result = result.concat(check);
    }
  }
  result.sort();
  return result;
}

function list(val) {
  return val.split(' ');
}


function main(argv){
  if(!argv) argv = process.env;
  commander
    .option("-a, --all", "run add tests")
    .option("-C, --chdir [dir]", "chdir to the specified directory")
    .option("-f, --format [pformat]", "run tests with the specified formats")
    .option("-G, --gyp_option <options>", "Add -G options to the gyp command line", list, [])
    .option("-l, --list", "list available tests and exit")
    .option("-n, --no-exec", "no execute, just print the command line")
    .option("--passed", "report passed tests")
    .option("--path <path>", "additional $PATH directory",list, [])
    .option("--q, --quiet", "quiet, don't print test command lines",list, [])
    .parse(process.argv);
  var i;
  if(commander.chdir) process.chdir(opts.chdir);
  var cwd = process.cwd();
  if(commander.path){
    for(i in commander.path){
      commander.path = path.resolve(cwd,commander.path[i]);
    }
    commander.path = commander.path.join(path.delimiter);
    process.env.PATH = commander.path+path.delimiter+process.env.PATH;
  }
  if(!commander.args){
    if(!commander.all){
      console.log('Specify -a to get all tests.');
      return true;
    }
    commander.args = ['test'];
  }
  var tests = [];
  for(i in commander.args){
    commander.args[i] = path.resolve(cwd, commander.args[i]);
    var check =find_all_gyptest_files(commander.args[i]);
    if(!check){
      console.error(commander.args[i]+" is not a valid gyp test name");
      process.exit(0)
    }
    tests = tests.concat(check);
  }
  cr = new CommandRunner();
  cr.verbose = !commander.quite;
  cr.active = !commander.no_exec;
  process.env.PYTHONPATH = path.resolve(cwd, "test/lib");
  if(!commander.quite){
    console.log('PYTHONPATH=%j', process.env.PYTHONPATH);
  }
  var passed = [];
  var failed = [];
  var no_result = [];

  if(commander.format){
    format_list = opts.format.split(',');
  }else{
    format_list = {
      'aix5':     ['make'],
      'freebsd7': ['make'],
      'freebsd8': ['make'],
      'openbsd5': ['make'],
      'cygwin':   ['msvs'],
      'win32':    ['msvs', 'ninja'],
      'linux2':   ['make', 'ninja'],
      'linux3':   ['make', 'ninja'],
      'darwin':   ['make', 'ninja', 'xcode'],
    }[os.platform()];
  }
  for(var fn in format_list){
    var format = format_list[fn];
    process.env.TESTGYP_FORMAT = format;
    if(!commander.quiet){
      console.log('TESTGYP_FORMAT=%j', format);
    }
  }
  var gyp_options = [];
  for(var option in commander.gyp_option){
    gyp_options.push(['-G', option]);
  }
  if(gyp_options && !commander.quiet){
    console.log('Extra Gyp options: %j', JSON.stringify(gyp_options));
  }
  async.series(tests,function(test,next){
    cr.run([python, test].concat(gyp_options),void(0),void(0),void(0),function(err,status){
      if(status == 2){
        no_result.ush(tests[i]);
      }else if(status){
        failed.push(tests[i]);
      }else{
        passed.push(tests[i]);
      }
    });
  },function(err,results){
    if(!commander.quiet){
      if(commander.passed){
        report("Passed", passed)
      }
      report("Failed", failed)
      report("No result from", no_result)
    }
    process.exit(failed.length > 0?1:0);
  })
}

function report(description,tests){
  if(!tests) return;
  if(tests.length == 1){
    console.log("\n%j the following test:", description)
  }else{
    var fmt = "\n%j the following %j tests:";
    console.log(fmt,description, tests.length);
    console.log("\t" + tests.join("\n\t"));
  }
}


if(!module.parent){
  main(function(){
    process.exit();
  })
}
