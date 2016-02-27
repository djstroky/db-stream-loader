var assert = require('chai').assert,
  moment = require('moment'),
  Sequelize = require('sequelize');

var dbStreamer = require('../../index.js');

var sequelizeConfig,
  streamerConfig = {
    tableName: 'test_table',
    columns: ['a', 'b', 'c', 'createdAt', 'updatedAt'],
    primaryKey: 'a'
  };

switch(process.env.DIALECT) {
  case 'mysql':
    sequelizeConfig = 'mysql://streamer:streamer1234@localhost:3306/streamer_test';
    break;
  case 'postgres':
    sequelizeConfig = 'postgres://streamer:streamer@localhost:5432/streamer_test';
    break;
  default:
    throw new Error('Invalid DIALECT');
    break;
}

streamerConfig.dbConnString = sequelizeConfig;

var sequelize = new Sequelize(sequelizeConfig, { logging: false }),
  testModel = sequelize.define('test_table', {
    a: {
      type: Sequelize.INTEGER,
      primaryKey: true
    },
    b: Sequelize.STRING,
    c: Sequelize.DATE
  }, {
    freezeTableName: true
  });

var assertDataExists = function(expectedObj, callback) {
  testModel
    .findOne({ where: { a: expectedObj.a } })
    .then(function(result) {
        for(k in expectedObj) {
          if(k === 'c') {
            assert.equal(moment.utc(expectedObj[k]).unix(), moment.utc(result[k]).unix());
          } else {
            assert.equal(expectedObj[k], result[k]);
          }
        }
      })
    .then(callback)
    .catch(callback);
}

describe('data loading', function() {

  beforeEach(function() {
    // (re)create table
    this.timeout(15000);

    return testModel.sync({force: true});
  });

  var tests = [
    { method: 'dialect', config: streamerConfig },
    { method: 'sequelize bulk', config: { useSequelizeBulkInsert: true, sequelizeModel: testModel} }
  ]

  for (var i = 0; i < tests.length; i++) {
    var test = tests[i];
    it('data should load using ' + test.method + ' inserter', function(done) {
      this.timeout(15000);

      // create inserter
      var inserter = dbStreamer.getInserter(test.config);

      // establish connection
      inserter.connect(function(err) {

        // push some rows
        var firstRow = {a: 1, b: 'one', c: new Date(12345) };
        inserter.push(firstRow);
        inserter.push({a: 2, b: 'two', c: new Date() });
        inserter.push({a: 3, b: 'three', c: new Date() });

        // create defered inserter
        test.config.deferUntilEnd = true;
        var deferedInserter = dbStreamer.getInserter(test.config),
          deferedRow = {a: 4, b: 'four', c: new Date(45678) };

        deferedInserter.push(deferedRow);
        deferedInserter.setEndHandler(function(err) {
            if(err) {
              done(err);
            } else {
              assertDataExists(deferedRow, done)
            }
          });

        // set end callback
        inserter.setEndHandler(function(err) {
          if(err) {
            done(err);
          } else {
            assertDataExists(firstRow, function(err) {
                if(err) {
                  done(err);
                } else {
                  deferedInserter.end();
                }
              });
          }
        });

        // announce end
        inserter.end();

      });
    });
  }
});