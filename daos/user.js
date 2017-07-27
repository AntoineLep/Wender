'use strict';

let fs = require('fs');

module.exports = function(dao, User) {
  if(User == null) {
    return null;
  }

  if(User.avatar != null) {
    try {
      let file = fs.readFileSync(User.avatar);
      let lastDotIndex = User.avatar.lastIndexOf('.');
      let ext = User.avatar.substr(lastDotIndex + 1, User.avatar.length - lastDotIndex);

      User.avatar = 'data:image/' + ext + ';base64,' + Buffer(file).toString('base64');
    } catch (e) { console.log('Can\'t find:' + User.avatar); }
  }
  
  var _User = {
    id: User.id,
    username: User.username,
    latitude: User.latitude,
    longitude: User.longitude,
    connected: User.connected,
    avatar: User.avatar
  };

  return _User;
};