lweb-init
=======

[![npm](https://img.shields.io/npm/v/lweb-init.svg?style=flat-square)](https://npmjs.org/package/lweb-init)

Init lilith game internal web app helper tools

> This project use reference of the project egg-init

## Install

```bash
npm i lweb-init -g
mkdir my-project && cd my-project
lweb-init
```

## Select a boilerplate on Internal gitlab address

```bash
? Please select a boilerplate type (Use arrow keys)
  ──────────────
❯ antd-simple - Simple front boilerplate based on antd, umi and dva
  egg-simple - Static web and file server based on egg.js
  koa-backend - Web backend boilerplate based on koa.js 
  egg-backend - Web backend boilerplate based on egg.js 
  antd-frontend - Web frontend boilerplate based on antd-pro
```

## Usage

```bash
init lilith web project from boilerplate.
Usage: lweb-init [dir] --type=egg-backend

Options：
  --type         boilerplate type                           [string]
  --dir          target directory                           [string]
  --package, -p  gitlab package name                       [boolean]
  --force, -f    force to override directory               [boolean]
  --version      Show version number                       [boolean]
  -h, --help     Show help                                 [boolean]
```

## Create a boilerplate

All the boilerplates are located on the lilith internal gitlab.

- Create a repo on the gitlab.
- Add `vars.js` file to the root of project.
- Config the variables and inject to the template.

demo:

```javascript
module.exports = {
  name: {
    desc: 'project name',
  },
  description: {
    desc: 'project description',
  },
  author: {
    desc: 'project author',
  },
  version: {
    desc: 'package version',
    default: '1.0.0',
  },
};
```

In your template files, use `{{-name-}}` to inject.