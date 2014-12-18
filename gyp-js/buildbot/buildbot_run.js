#!/usr/bin/env node
// Copyright (c) 2012 Google Inc. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Argument-less script to select what to run on the buildbots.

var os = require("os");
var path = require("path");
var child_process = require("child_process");
var fs = require("fs");
var rimraf = require("rimraf");

if(/win32|cygwin/.test(os.platform())){
  global.EXE_SUFFIX = '.exe';
}else{
  global.EXE_SUFFIX = ""
}

global.BUILDBOT_DIR = __filename;
global.TRUNK_DIR = __dirname;
global.ROOT_DIR = path.resolve(__dirname,"../");
global.ANDROID_DIR = path.resolve(ROOT_DIR,"android");
global.CMAKE_DIR = path.resolve(ROOT_DIR,"cmake");
global.CMAKE_BIN_DIR = path.resolve(CMAKE_DIR,"bin");
global.OUT_DIR = path.resolve(TRUNK_DIR,"out");

function prepareDir(dirname,calls,next){
  if(process.env.BUILDBOT_CLOBBER == "1"){
    console.log('@@@BUILD_STEP Clobber "+dirname+" checkout@@@');
    try{
      rimrafSync(dirname);
    }catch(e){
      return next(e);
    }
  }
  try{
    var stats = fs.statSync(dirname);
    if(stats.isDir()){
      return next(new Error("Successfully deleted directory, but directory still exists"));
    }
  }catch(e){
  }
  console.log('@@@BUILD_STEP Initialize "+dirname+" checkout@@@');
  fs.mkdir(dirname,function(err){
    if(err) return next(err);
  });
  calls = [
  ['git', 'config', '--global', 'user.name', 'trybot'],
  ['git', 'config', '--global',
  'user.email', 'chrome-bot@google.com'],
  ['git', 'config', '--global', 'color.ui', 'false']
  ].concat(calls);

  async.eachSeries(calls,function(item,next){
    item = item.join(" ");
    child_process.exec(item,{cwd:dirname},next);
  },function(err,results){
    if(err){
      console.log("build error");
    }
    next(err,results);
  })
}

module.exports.PrepareCMake = function PrepareCMake(next){
  prepareDir(CMAKE_DIR,[
    //Build Step Sync CMake
    ['git', 'clone',
    '--depth', '1',
    '--single-branch',
    '--branch', 'v2.8.8',
    '--',
    'git://cmake.org/cmake.git',
    CMAKE_DIR],
    //Build Step Build CMAKE
    ['repo', 'sync', '-j4'],
    //Build Step Build Android
    ['/bin/bash', 'bootstrap', '--prefix='+CMAKE_DIR ],
    ["make cmake"]
  ],next)
};


module.exports.PrepareAndroidTree = function PrepareAndroidTree(next){
  prepareDir(ANDROID_DIR,[
    ['repo', 'init',
    '-u', 'https://android.googlesource.com/platform/manifest',
    '-b', 'android-4.2.1_r1',
    '-g', 'all,-notdefault,-device,-darwin,-mips,-x86'],
    //Build Step Sync Android
    ['repo', 'sync', '-j4'],
    //Build Step Build Android
    ['/bin/bash',
    '-c', 'source build/envsetup.sh && lunch full-eng && make -j4']
  ],next);
};

module.exports.GypTestFormat = function(title,format,msvs_version,next){
  /* Run the gyp tests for a given format, emitting annotator tags.

  See annotator docs at:
  https://sites.google.com/a/chromium.org/dev/developers/testing/chromium-build-infrastructure/buildbot-annotations
  Args:
  format: gyp format to test.
  Returns:
  0 for sucesss, 1 for failure.
  */

  if(typeof format == "function"){
    next = format;
    format = title;
  }

  console.log('@@@BUILD_STEP ' + title + '@@@');
  var env = JSON.parse(JSON.stringify(process.env));
  if(msvs_version){
    env.GYP_MSVS_VERSION = msvs_version;
  }
  var command =
  [sys.executable, 'trunk/gyptest.py',
  '--all',
  '--passed',
  '--format', format,
  '--path', CMAKE_BIN_DIR,
  '--chdir', 'trunk'].join(" ");
  if(format == 'android'){
    // gyptest needs the environment setup from envsetup/lunch in order to build
    // using the 'android' backend, so this is done in a single shell.
    env.cwd = ANDROID_DIR;
    child_process.exec(
      ['/bin/bash',
      '-c',
      'source build/envsetup.sh && lunch full-eng && cd',
      ROOT_DIR,
      '&&',
      command
      ],
      env,
      next
    );
  }else{
    env.cwd = ROOR_DIR;
    child_process.exec(command, env, next);
  }
}

module.exports.GypBuild = function GypBuild(next){
  // Dump out/ directory.
  console.log('@@@BUILD_STEP cleanup@@@');
  console.log('Removing %s...' % OUT_DIR);
  try{
    rimrafSync(OUT_DIR);
  }catch(e){
  }
  console.log('Done.');
  var tests;
  var plat = os.platform();
  // The Android gyp bot runs on linux so this must be tested first.
  if(process.env.BUILDBOT_BUILDERNAME == 'gyp-android'){
    tests = [
    PrepareAndroidTree,
    GypTestFormat.bind('android')
    ];
  }else if(/^linux/.test(plat)){
    tests = [
    GypTestFormat.bind('ninja'),
    GypTestFormat.bind('make'),
    PrepareCMake,
    GypTestFormat.bind('cmake')
    ];
  }else if(plat == 'darwin'){
    tests = [
    GypTestFormat.bind('ninja'),
    GypTestFormat.bind('xcode'),
    GypTestFormat.bind('make')
    ];
  }else if(plat == 'win32'){
    tests = [ GypTestFormat('ninja') ];
    if(process.env.BUILDBOT_BUILDERNAME == 'gyp-win64'){
      tests = tests.concat([
        GypTestFormat.bind('msvs-2010', format='msvs', msvs_version='2010'),
        GypTestFormat.bind('msvs-2012', format='msvs', msvs_version='2012')
      ]);
    }
  }else throw new Error('Unknown platform');
  async.series(tests,function(err,results){
    // TODO(bradnelson): once the annotator supports a postscript (section for
    //     after the build proper that could be used for cumulative failures),
    //     use that instead of this. This isolates the final return value so
    //     that it isn't misattributed to the last stage.
    if(next) return next(err,results);
    if(err){
      throw err;
    }
  });
}
if(!module.parent){
  GypBuild(function(err){

    if(err){
      throw err;
    }
    console.log("done");
  });
}
