'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
const inquirer = require('inquirer');
const yargs = require('yargs');
const memFs = require('mem-fs');
const editor = require('mem-fs-editor');
const glob = require('glob');
const is = require('is-type-of');
const rimraf = require('mz-modules/rimraf');
const isTextOrBinary = require('istextorbinary');
const downloadRepo = require('download-git-repo');

require('colors');

module.exports = class Command {
  constructor(options) {
    options = options || {};
    this.name = options.name || 'lweb-init';
    this.pkgInfo = options.pkgInfo || require('../package.json');

    this.inquirer = inquirer;
  }

  * run(cwd, args) {
    const argv = this.argv = this.getParser().parse(args || []);
    this.cwd = cwd;

    this.targetDir = yield this.getTargetDirectory();

    let pkgName = this.argv.package;
    if (!pkgName) {

      const boilerplateMapping = yield this.fetchBoilerplateMapping();

      let boilerplate;
      if (argv.type && boilerplateMapping.hasOwnProperty(argv.type)) {
        boilerplate = boilerplateMapping[ argv.type ];
      } else {
        boilerplate = yield this.askForBoilerplateType(boilerplateMapping);
      }
      this.log(`use boilerplate: ${boilerplate.name}(${boilerplate.package})`);
      pkgName = boilerplate.package;
    }

    // const author = yield this.askForAuthor();
    const templateDir = yield this.downloadBoilerplate(pkgName);

    yield this.processFiles(this.targetDir, templateDir);

    this.printUsage(this.targetDir);
  }

  groupBy(obj, key, otherKey) {
    const result = {};
    for (const i in obj) {
      let isMatch = false;
      for (const j in obj[i]) {
        if (j === key) {
          const mappingItem = obj[i][j];
          if (typeof result[mappingItem] === 'undefined') {
            result[mappingItem] = {};
          }
          result[mappingItem][i] = obj[i];
          isMatch = true;
          break;
        }
      }
      if (!isMatch) {
        if (typeof result[otherKey] === 'undefined') {
          result[otherKey] = {};
        }
        result[otherKey][i] = obj[i];
      }
    }
    return result;
  }

  * askForBoilerplateType(mapping) {
    const groupMapping = this.groupBy(mapping, 'category', 'other');
    const groupNames = Object.keys(groupMapping);
    let group;
    if (groupNames.length > 1) {
      const answers = yield inquirer.prompt({
        name: 'group',
        type: 'list',
        message: 'Please select a boilerplate category',
        choices: groupNames,
        pageSize: groupNames.length,
      });
      group = groupMapping[answers.group];
    } else {
      group = groupMapping[groupNames[0]];
    }

    const choices = Object.keys(group).map(key => {
      const item = group[key];
      return {
        name: `${key} - ${item.description}`,
        value: item,
      };
    });

    choices.unshift(new inquirer.Separator());
    const answers = yield inquirer.prompt({
      name: 'type',
      type: 'list',
      message: 'Please select a boilerplate type',
      choices,
      pageSize: choices.length,
    });
    return answers.type;
  }

  * askForAuthor() {
    const answers = yield inquirer.prompt({
      name: 'author',
      type: 'input',
      message: 'Please input author\'s username',
    });
    return answers.author;
  }

  * askForVariable(targetDir, templateDir) {
    let questions;
    try {
      questions = require(path.join(templateDir, 'vars.js'));
      // support function
      if (is.function(questions)) {
        questions = questions(this);
      }
      // use target dir name as `name` default
      if (questions.name && !questions.name.default) {
        questions.name.default = path.basename(targetDir).replace(/^lweb-/, '');
      }
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND') {
        this.log(`load boilerplate config got trouble, skip and use defaults, ${err.message}`.yellow);
      }
      return {};
    }

    this.log('collecting boilerplate config...');
    const keys = Object.keys(questions);
    if (this.argv.silent) {
      const result = keys.reduce((result, key) => {
        const defaultFn = questions[key].default;
        const filterFn = questions[key].filter;
        if (typeof defaultFn === 'function') {
          result[key] = defaultFn(result) || '';
        } else {
          result[key] = questions[key].default || '';
        }
        if (typeof filterFn === 'function') {
          result[key] = filterFn(result[key]) || '';
        }

        return result;
      }, {});
      this.log('use default due to --silent, %j', result);
      return result;
    } else {
      return yield inquirer.prompt(keys.map(key => {
        const question = questions[key];
        return {
          type: 'input',
          name: key,
          message: question.description || question.desc,
          default: question.default,
          filter: question.filter,
        };
      }));
    }
  }

  * processFiles(targetDir, templateDir) {
    const src = templateDir;
    const locals = yield this.askForVariable(targetDir, templateDir);
    const fsEditor = editor.create(memFs.create());
    const files = glob.sync('**/*', { cwd: src, dot: true, nodir: true });
    files.forEach(file => {
      const from = path.join(src, file);
      const to = path.join(targetDir, this.replaceTemplate(file, locals));
      fsEditor.copy(from, to, {
        process: (content, filePath) => {
          this.log('write to %s', to);
          if (isTextOrBinary.isTextSync(filePath, content)) {
            return this.replaceTemplate(content, locals);
          }
          return content;
        },
      });
    });

    yield new Promise(resolve => fsEditor.commit(resolve));

    // remove vars.js
    const varsPath = path.join(targetDir, 'vars.js');
    if (fs.existsSync(varsPath)) {
      fs.unlinkSync(varsPath);
    }

    return files;
  }

  getParser() {
    return yargs
      .usage('init lilith web project from boilerplate.\nUsage: $0 [dir] --type=egg-backend')
      .options(this.getParserOptions())
      .alias('h', 'help')
      .version()
      .help();
  }

  getParserOptions() {
    return {
      type: {
        type: 'string',
        description: 'boilerplate type',
      },
      dir: {
        type: 'string',
        description: 'target directory',
      },
      force: {
        type: 'boolean',
        description: 'force to override directory',
        alias: 'f',
      },
    };
  }

  * getTargetDirectory() {
    const dir = this.argv._[0] || this.argv.dir || '';
    let targetDir = path.resolve(this.cwd, dir);
    const force = this.argv.force;

    this.log(dir);

    const validate = dir => {
      if (!fs.existsSync(dir)) {
        mkdirp.sync(dir);
        return true;
      }

      if (!fs.statSync(dir).isDirectory()) {
        return `${dir} already exists as a file`.red;
      }

      const files = fs.readdirSync(dir).filter(name => name[0] !== '.');
      if (files.length > 0) {
        if (force) {
          this.log(`${dir} already exists and will be override due to --force`.red);
          return true;
        }
        return `${dir} already exists and not empty: ${JSON.stringify(files)}`.red;
      }
      return true;
    };

    const isValid = validate(targetDir);
    if (isValid !== true) {
      this.log(isValid);
      const answer = yield this.inquirer.prompt({
        name: 'dir',
        message: 'Please enter target dir: ',
        default: dir || '.',
        filter: dir => path.resolve(this.cwd, dir),
        validate,
      });
      targetDir = answer.dir;
    }
    this.log(`target dir is ${targetDir}`);
    return targetDir;
  }

  * fetchBoilerplateMapping() {
    const pkgInfo = this.pkgInfo;
    const mapping = pkgInfo.config.boilerplate;
    Object.keys(mapping).forEach(key => {
      const item = mapping[key];
      item.name = item.name || key;
      item.from = pkgInfo;
    });
    return mapping;
  }

  printUsage() {
    this.log(`usage:
      - cd ${this.targetDir}
      - npm install
      - npm start / npm run dev / npm test
    `);
  }

  replaceTemplate(content, scope) {
    return content.toString().replace(/(\\)?{{ *(\w+) *}}/g, (block, skip, key) => {
      if (skip) {
        return block.substring(skip.length);
      }
      return scope.hasOwnProperty(key) ? scope[key] : block;
    });
  }

  * downloadBoilerplate(pkgName) {
    const download = (repo, dest, opts) => {
      return new Promise((resolve, reject) => {
        downloadRepo(repo, dest, opts, err => {
          if (err) {
            this.log(err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    };

    const repoUrl = `${this.pkgInfo.config.gitlab.url}/${pkgName}.git`;
    const saveDir = path.join(os.tmpdir(), 'lweb-init-boilerplate');
    yield rimraf(saveDir);

    this.log(`downloading ${repoUrl}`);
    yield download(`direct:${repoUrl}`, path.join(saveDir, pkgName), { clone: true });

    this.log(`download to ${saveDir}`);
    return path.join(saveDir, pkgName);
  }

  * curl(url, options) {
    return yield this.httpClient.request(url, options);
  }

  log() {
    const args = Array.prototype.slice.call(arguments);
    args[0] = `[${this.name}] `.blue + args[0];
    console.log.apply(console, args);
  }
};
