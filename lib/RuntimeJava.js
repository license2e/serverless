'use strict';

const SError = require('./Error'),
  SCli = require('./utils/cli'),
  _ = require('lodash'),
  exec = require('child_process').exec,
  execSync = require('child_process').execSync,
  BbPromise = require('bluebird'),
  chalk = require('chalk'),
  context = require('./utils/context'),
  path = require('path'),
  fs = BbPromise.promisifyAll(require('fs')),
  fse = BbPromise.promisifyAll(require('fs-extra'));
  // pathSepRegExp = new RegExp(path.sep, 'g');

module.exports = function (S) {

  class RuntimeNode extends S.classes.Runtime {

    static getName() {
      return 'java8';
    }

    getName() {
      return this.constructor.getName();
    }

    /**
     * Scaffold
     * - Create scaffolding for new Java function
     */

    scaffold(func) {
      let that = this;
      let javaTemplates = [
        'Handler',
        'Request',
        'Response',
        'FakeContext'
      ];
      let gradleTemplates = [
        'settings.gradle'
      ];
      let gradleFiles = [
        'build.gradle',
        'gradlew',
        'gradlew.bat'
      ];
      let ctx = {
        projectName: S.getProject().getName(),
        functionName: func.getName(),
        package: this.packageName(func)
      };

      return new BbPromise(function (resolve, reject) {
        javaTemplates.map(function (filename) {
          return new BbPromise(function (resolve, reject) {
            let f = path.join(S.getServerlessPath(), 'templates', 'java', filename + '.java');
            fs.readFileAsync(f)
              .then(function (tpl) {
                let content = _.template(tpl)(ctx);
                let outFile = that.srcPath(func, filename + ".java");
                S.utils.writeFile(outFile, content);
                resolve();
              });
          });
        });
        gradleTemplates.map(function (filename) {
          return new BbPromise(function (resolve, reject) {
            let f = path.join(S.getServerlessPath(), 'templates', 'java', filename);
            fs.readFileAsync(f)
              .then(function (tpl) {
                let content = _.template(tpl)(ctx);
                let outFile = path.join(func.getRootPath(), filename);
                S.utils.writeFile(outFile, content);
                resolve();
              });
          });
        });
        gradleFiles.map(function (filename) {
          return new BbPromise(function (resolve, reject) {
            let inFile = path.join(S.getServerlessPath(), 'templates', 'java', filename);
            let outFile = path.join(func.getRootPath(), filename);
            fs.createReadStream(inFile).pipe(fs.createWriteStream(outFile));
          });
        });
        S.utils.writeFile(func.getRootPath('event.json'), { input: 'Hello!' });
        resolve();
      });
    }

    srcPath(func, file) {
      // let project = S.getProject();
      let pkg = this.packagePath(func);
      var src = path.join(func.getRootPath(), 'src', 'main', 'java', pkg);
      return file ? path.join(src, file) : src;
    }

    // packageHandlerPath(p) {
    //   let firstPart = []
    //   const pList = p.split(path.sep);
    //   firstPart.push(pList.shift());
    //   firstPart.push(pList.shift());
    //   return firstPart.join('.') + '.' + pList.join('_');
    // }

    packageName(func) {
      let pp = this.packagePath(func);
      return pp;
    }

    packagePath(func) {
      // let project = S.getProject();
      // const rootPath = project.getRootPath() + path.sep;
      // var parent = func.getFilePath().replace(rootPath, '');
      // parent = parent.substr(0, parent.lastIndexOf(`${path.sep}s-function.json`)) || parent;
      // return parent;
      return func.getName().replace(/-/g, '_');
    }

    jarFile(func) {
      // let project = S.getProject();
      const funcPath = func.getFilePath().replace('s-function.json', '');
      return path.join(funcPath, 'build', 'libs', func.getName() + '-all.jar');
    }

    promiseFromChildProcess(child) {
      return new BbPromise(function (resolve, reject) {
        child.addListener("error", reject);
        child.addListener("exit", resolve);
      });
    }

    compileJar(func, stage, region, event) {
      const funcPath = func.getFilePath().replace('s-function.json', '');

      try {
        const gradlerWrapperStats = fs.statSync(path.join(`${funcPath}`, 'gradle', 'wrapper'));
      } catch(e) {
        execSync('gradle wrapper', {cwd: funcPath})
      }

      return this.getEnvVars(func, stage, region)
        .then((env) => {
          const envVars = _.merge(env, process.env);
          return new BbPromise((resolve) => {
            // Call Gradle
            SCli.log(chalk.bold('Compiling Java sources...'));
            const child = exec(`${funcPath}gradlew shadowJar`,
              { stdio: [0, 1, 2], env: envVars, cwd: funcPath },
              (error, stdout, stderr) => {
                SCli.log(`-----------------`);
                // Show error
                if (error) {
                  SCli.log(chalk.bold('Failed - This Error Was Returned:'));
                  SCli.log(error.message);
                  SCli.log(error.stack);

                  return resolve({
                    status: 'error',
                    response: error.message,
                    error: error
                  });
                }

                // Show success response
                SCli.log(stdout);
                return resolve({
                  status: 'success',
                  response: stdout
                });
              });

          });
        });
    }

    buildGradle(func, stage, region) {
      const funcPath = func.getFilePath().replace('s-function.json', '');
      return this.getEnvVars(func, stage, region)
        .then((env) => {
          const envVars = _.merge(env, process.env);
          return new BbPromise((resolve, reject) => {
            // Call Gradle
            SCli.log(chalk.bold('Building Java sources...'));
            const child = exec(`gradle build`,
              { stdio: [0, 1, 2], env: envVars, cwd: funcPath },
              (error, stdout, stderr) => {
                SCli.log(`-----------------`);
                // Show error
                if (error) {
                  SCli.log(chalk.bold('Failed - This Error Was Returned:'));
                  SCli.log(error.message);
                  SCli.log(error.stack);

                  return resolve({
                    status: 'error',
                    response: error.message,
                    error: error
                  });
                }

                // Show success response
                SCli.log(stdout);
                return resolve({
                  status: 'success',
                  response: stdout
                });
              });

          });
        });
    }

    /**
     * Run
     * - Run this function locally
     */
    run(func, stage, region, event) {
      let _this = this;
      return this.compileJar(func, stage, region, event)
      .then(this.getEnvVars(func, stage, region))
        .then((env) => {
          const functionJar = _this.jarFile(func),
            functionHandler = func.handler,
            eventJson = func.getRootPath('event.json'),
            result = {};

          const envVars = _.merge(env, process.env);

          return new BbPromise((resolve) => {
            // Call JVM

            const child = exec('java -cp ' + functionJar + ' ' + functionHandler + ' ' + eventJson,
              { stdio: [0, 1, 2], env: envVars },
              (error, stdout, stderr) => {
                SCli.log(`-----------------`);
                // Show error
                if (error) {
                  SCli.log(chalk.bold('Failed - This Error Was Returned:'));
                  SCli.log(error.message);
                  SCli.log(error.stack);

                  return resolve({
                    status: 'error',
                    response: error.message,
                    error: error
                  });
                }

                // Show success response
                SCli.log(chalk.bold('Success! - This Response Was Returned:'));
                SCli.log(stdout);
                return resolve({
                  status: 'success',
                  response: stdout
                });
              });

          });
        });
    }

    /**
     * Copy Function
     * - Copies function to dist dir
     */

    copyFunction(func, pathDist, stage, region) {
      // Status
      S.utils.sDebug(`"${stage} - ${region} - ${func.getName()}": Copying in dist dir ${pathDist}`);

      // Extract the root of the lambda package from the handler property
      let handlerFullPath = func.getRootPath(_.last(func.handler.split('/'))).replace(/\\/g, '/');

      // Check handler is correct
      if (!handlerFullPath.endsWith(func.handler)) {
        return BbPromise.reject(new SError(`This function's handler is invalid and not in the file system: ` + func.handler));
      }

      let packageRoot = handlerFullPath.replace(func.handler, '');
      packageRoot = path.join(packageRoot, 'build', 'distributions');
      // throw new Error(`${packageRoot} - ${pathDist}`);

      return fse.copyAsync(packageRoot, pathDist, {
        filter: this._processExcludePatterns(func, pathDist, stage, region),
        dereference: true
      });
    }

    /**
     * Build
     * - Build the function in this runtime
     */

    build(func, stage, region) {

      // Validate
      if (!func._class || func._class !== 'Function') return BbPromise.reject(new SError('A function instance is required'));

      let pathDist;

      return this.buildGradle(func, stage, region)
        .then(() => this.createDistDir(func.name))
        .then(function (distDir) {
          pathDist = distDir;
        })
        .then(() => this.copyFunction(func, pathDist, stage, region))
        .then(function () {
          return pathDist;
        });
    }

    /**
     * Get Handler
     */

    getHandler(func) {
      return func.handler;
    }

    getHandlerName(path, funcName) {
      return funcName.replace(/-/g, '_') + '.Handler'; //.replace(pathSepRegExp, '.') + '.Handler';
    }

    /**
     * Install NPM Dependencies
     */

    installDependencies(dir) {
      SCli.log(`Installing NPM dependencies in dir: ${dir}`);
      SCli.log(`-----------------`);
      S.utils.npmInstall(S.getProject().getRootPath(dir));
      SCli.log(`-----------------`);
    }
  }

  return RuntimeNode;
};
