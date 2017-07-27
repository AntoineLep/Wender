'use strict';
module.exports = function(dao, User) {
  if(User == null) {
    return null;
  }
  
  var _UserLight = {
    id: User.id,
    username: User.username,
    avatar: User.avatar
  };

  return _UserLight;
};