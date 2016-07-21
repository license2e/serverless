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
  fse = BbPromise.promisifyAll(require('fs-extra')),
  xml2js = require('xml2js');
  // pathSepRegExp = new RegExp(path.sep, 'g');

module.exports = function (S) {

  class RuntimeJava8 extends S.classes.Runtime {

    constructor() {
      super();
      this.buildTool = null;
      this.jarFilePath = null;
    }

    static getName() {
      return 'java8';
    }

    getName() {
      return this.constructor.getName();
    }

    /**
     * Template Prompt
     * - Prompt user for extra template options
     */

    templatePrompts(func) {
      let that = this;
      let cliPlugin = new S.classes.Plugin();

      let choices = [
        {
          key: '',
          value: 'maven',
          label: 'Maven'
        },
        {
          key: '',
          value: 'gradle',
          label: 'Gradle'
        }
      ];

      return cliPlugin.cliPromptSelect(`Please, select a supported build tool`, choices, false)
        .then(values => that.buildTool = values[0].value);
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
      let mavenTemplates = [
        'pom.xml'
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
            let f = path.join(S.getServerlessPath(), 'templates', 'java8', filename + '.java');
            fs.readFileAsync(f)
              .then(function (tpl) {
                let content = _.template(tpl)(ctx);
                let outFile = that.srcPath(func, filename + ".java");
                S.utils.writeFile(outFile, content);
                resolve();
              });
          });
        });

        if (that.buildTool === 'maven') {
          mavenTemplates.map(function (filename) {
            return new BbPromise(function (resolve, reject) {
              let f = path.join(S.getServerlessPath(), 'templates', 'java8', that.buildTool, filename);
              fs.readFileAsync(f)
                .then(function (tpl) {
                  let content = _.template(tpl)(ctx);
                  let outFile = path.join(func.getRootPath(), filename);
                  S.utils.writeFile(outFile, content);
                  resolve();
                });
            });
          });
        } else if (that.buildTool === 'gradle') {
          gradleTemplates.map(function (filename) {
            return new BbPromise(function (resolve, reject) {
              let f = path.join(S.getServerlessPath(), 'templates', 'java8', that.buildTool, filename);
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
              let inFile = path.join(S.getServerlessPath(), 'templates', 'java8', that.buildTool, filename);
              let outFile = path.join(func.getRootPath(), filename);
              fs.createReadStream(inFile).pipe(fs.createWriteStream(outFile));
            });
          });
        }
        S.utils.writeFile(func.getRootPath('event.json'), { input: 'Hello!' });
        resolve();
      });
    }

    srcPath(func, file) {
      // let project = S.getProject();
      let pkg = this.packagePath(func);
      const src = path.join(func.getRootPath(), 'src', 'main', 'java', pkg);
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
      return new BbPromise(function (resolve, reject) {
        // let project = S.getProject();
        const funcPath = func.getFilePath().replace('s-function.json', '');

        let jarFilePath = '';
        switch (func.buildTool) {
          case 'maven':
            let xmlParser = new xml2js.Parser();
            const pomFile = path.join(funcPath, 'pom.xml');
            const pomFileContent = fs.readFileSync(pomFile, 'utf-8');
            xmlParser.parseString(pomFileContent, function (err, result) {
              jarFilePath = path.join(funcPath, 'target', `${func.getName()}-${result.project.version[0]}.jar`);
              resolve(jarFilePath);
            });
            break;

          case 'gradle':
            jarFilePath = path.join(funcPath, 'build', 'libs', `${func.getName()}-all.jar`);
            resolve(jarFilePath);
            break;

          default:
            reject(`Error: build tool not found: ${func.buildTool}`);
            break;
        }
      });
    }

    promiseFromChildProcess(child) {
      return new BbPromise(function (resolve, reject) {
        child.addListener("error", reject);
        child.addListener("exit", resolve);
      });
    }

    compileJar(func, stage, region, event) {

      return this.getEnvVars(func, stage, region)
        .then((env) => {
          const funcPath = func.getFilePath().replace('s-function.json', '');
          const envVars = _.merge(env, process.env);
          return new BbPromise((resolve) => {

            let compileCmd = `echo "Error: build tool not found: ${func.buildTool}" && exit 1`;
            switch (func.buildTool) {
              case 'maven':
                compileCmd = 'mvn package';
                break;

              case 'gradle':
                compileCmd = `${funcPath}gradlew shadowJar`;
                try {
                  const gradlerWrapperStats = fs.statSync(path.join(`${funcPath}`, 'gradle', 'wrapper'));
                } catch(e) {
                  execSync('gradle wrapper', {cwd: funcPath})
                }
                break;

              default:
                break;
            }

            // Call Gradle
            SCli.log(chalk.bold('Compiling Java sources...'));
            const child = exec(compileCmd,
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

    buildJars(func, stage, region) {
      let _this = this;
      const funcPath = func.getFilePath().replace('s-function.json', '');
      return _this.getEnvVars(func, stage, region)
        .then((env) => {
          const envVars = _.merge(env, process.env);
          return new BbPromise((resolve, reject) => {
            // Call Gradle
            SCli.log(chalk.bold('Building Java sources...'));

            let buildCmd = `echo "Error: build tool not found: ${func.buildTool}" && exit 1`;
            switch (func.buildTool) {
              case 'maven':
                buildCmd = 'mvn package';
                break;

              case 'gradle':
                buildCmd = 'gradle build';
                break;

              default:
                break;
            }

            const child = exec(buildCmd,
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
                    jarFile: null,
                    error: error
                  });
                }

                // Show success response
                SCli.log(stdout);

                // Get the jarFile
                _this.jarFile(func)
                .then((jarFile) => {
                  resolve({
                    status: 'success',
                    response: stdout,
                    jarFile: jarFile
                  });
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
      let envVars = {};
      return this.compileJar(func, stage, region, event)
        .then(this.getEnvVars(func, stage, region))
        .then((env) => {
          envVars = env;
          return _this.jarFile(func);
        })
        .then((functionJar) => {

          const functionHandler = func.handler,
            eventJson = func.getRootPath('event.json'),
            result = {};

          const localEnvVars = _.merge(envVars, process.env);

          return new BbPromise((resolve) => {

            // Call JVM
            const runCmd = `java -cp ${functionJar} ${functionHandler} ${eventJson}`;
            SCli.log(`-----------------`);
            SCli.log(`Java Run Command: ${runCmd}`);

            const child = exec(runCmd,
              { stdio: [0, 1, 2], env: localEnvVars },
              (error, stdout, stderr) => {
                SCli.log(`=================`);
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
      let _this = this;
      // Status
      S.utils.sDebug(`"${stage} - ${region} - ${func.getName()}": Copying to dist dir ${pathDist}`);
      S.utils.sDebug(`"${stage} - ${region} - ${func.getName()}": Jar file path ${_this.jarFilePath}`);

      return new BbPromise(function (resolve, reject) {

        // Extract the root of the lambda package from the handler property
        let handlerFullPath = func.getRootPath(_.last(func.handler.split('/'))).replace(/\\/g, '/');

        // Check handler is correct
        if (!handlerFullPath.endsWith(func.handler)) {
          return BbPromise.reject(new SError(`This function's handler is invalid and not in the file system: ` + func.handler));
        }

        let packageRoot = handlerFullPath.replace(func.handler, '');
        switch (func.buildTool) {
          case 'maven':
            const funcPath = func.getFilePath().replace('s-function.json', '');
            const unzipCommand = `unzip ${_this.jarFilePath} -d ${pathDist}/`
            const child = exec(unzipCommand,
              { stdio: [0, 1, 2], cwd: funcPath },
              (error, stdout, stderr) => {
                SCli.log(`-----------------`);
                // Show error
                if (error) {
                  SCli.log(chalk.bold('Failed - This Error Was Returned:'));
                  SCli.log(error.message);
                  SCli.log(error.stack);

                  return reject(new SError(error.message));
                }

                // Show success response
                SCli.log(stdout);
                return resolve({
                  status: 'success',
                  response: stdout
                });
              });
            break;

          case 'gradle':
            packageRoot = path.join(packageRoot, 'build', 'distributions');
            return fse.copyAsync(packageRoot, pathDist, {
              filter: this._processExcludePatterns(func, pathDist, stage, region),
              dereference: true
            });
            break;

          default:
            return reject(new SError(`This function's buildTool is invalid: ` + func.buildTool));
            break;
        }

      });

    }

    /**
     * Build
     * - Build the function in this runtime
     */

    build(func, stage, region) {

      let _this = this;

      // Validate
      if (!func._class || func._class !== 'Function') return BbPromise.reject(new SError('A function instance is required'));

      let pathDist, jarFilePath;

      return this.buildJars(func, stage, region)
        .then((results) => {
          if (results.status === 'error') {
            throw new Error(results.error);
          } else {
            _this.jarFilePath = results.jarFile;
          }
        })
        .then(() => this.createDistDir(func.name))
        .then(function (distDir) {
          pathDist = distDir;
        })
        .then(() => {
          return this.copyFunction(func, pathDist, stage, region);
        })
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

    getBuildTool() {
      return this.buildTool;
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

  return RuntimeJava8;
};
