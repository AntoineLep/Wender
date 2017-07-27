'use strict';

let fs = require('fs');

module.exports = function(dao, User) {
  if(User == null) {
    return null;
  }
  
  var _UserOptimized = {
    id: User.id,
    username: User.username,
    latitude: User.latitude,
    longitude: User.longitude,
    connected: User.connected
  };

  return _UserOptimized;
};