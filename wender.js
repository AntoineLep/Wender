// Node modules
let app         = require('express')();
let fs          = require('fs');
let server      = require('https').createServer(
                    {
                      key: fs.readFileSync('key.pem'),
                      cert: fs.readFileSync('cert.pem')
                    }, app);
let io          = require('socket.io').listen(server);
let socketioJwt = require('socketio-jwt')
let helmet      = require('helmet');
let bodyParser  = require('body-parser');
let jwt         = require('jsonwebtoken');
let md5         = require('md5');
let config      = require('./config/config')
let models      = require('./models');
let daos        = require('./daos');
let validator   = require('validator');

// CONFIGURATION

let port = process.env.PORT || 443;
let imgStoragePath = './public/img/';
let avatarStoragePath = imgStoragePath + 'avatars/';
let maxImageSize = 200 * 1024;
app.set('jwtSecret', config.secret);

models.sequelize.sync().then(() => {

  app
  .use(helmet())
  .use(bodyParser.urlencoded({ extended: true }))
  .use(bodyParser.json())
  .use((req, res, next) => {
    res.setHeader('Content-Type', 'application/json');
    next();
  })

  //---------------------------------------------------------------------------
  // PUBLIC ROUTES
  //--------------

  .get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html')
    return res.sendFile(__dirname + '/public/index.html');
  })

    .get('/gcu', (req, res) => {
    res.setHeader('Content-Type', 'text/html')
    return res.sendFile(__dirname + '/public/gcu.html');
  })

  // Todo : Add the avatar
  .post('/signup', (req, res) => {
    if(req.body.username !== undefined && req.body.email !== undefined && req.body.password !== undefined) {
      if(validator.isEmail(req.body.email)) {
        models.User.findOne({
          where: { $or: {email: req.body.email, username: req.body.username }}
        }).then((matchingUser) => {
          if(matchingUser == null) {
            models.User.create({ 
              username: req.body.username,
              email: req.body.email,
              password: md5(req.body.password)
            }).then((newUser) => {
              if(newUser != null) {
                res.status(201).json({success: true, user: daos.User(daos, newUser)});
              } else { res.status(520).json({succes: false, message: 'Unable to create new user'}) }
            });
          } else { res.status(400).json({success: false, message: 'A user with this email address or username already exists'}); }
        });
      } else { res.status(400).json({success: false, message: 'Email not valid'}); }
    } else { res.status(400).json({success: false, message: 'Missing one of the following params: username, email, password'}); }
  })

  .post('/login', (req, res) => {
    if(req.body.email !== undefined && req.body.password !== undefined) {
      models.User.findOne({
        where: {
          email: req.body.email,
          password: md5(req.body.password)
        }
      }).then((matchingUser) => {
        if(matchingUser != null) {
          console.log("User id: " + matchingUser.id + " got a new token");
          let jwtToken = jwt.sign(
            {
              userId: matchingUser.id,
              email: matchingUser.email
            },
            app.get('jwtSecret'), {expiresIn: "1d"}
          ); // 1 day token

          res.json({success: true, token: jwtToken});
        } else { res.status(400).json({succes: false, message: "Email / password is not valid"}); }
      });
    } else { return res.status(400).json({succes: false, message: "Email / password fields required"}); }
  })

  // Authentication
  .use((req, res, next) => {
    let token = req.body.token || req.query.token || req.headers['x-access-token'];
    if (token) {
      jwt.verify(token, app.get('jwtSecret'), (err, decoded) => {
        if (err) {
          res.status(400).json({success: false, message: 'Failed to authenticate token'});
        } else {
          req.decoded = decoded; // Save it for the other routes
          next();
        }
      });
    } else { return res.status(401).send({success: false, message: 'No token provided'}); }
  })

  //---------------------------------------------------------------------------
  // PRIVATE ROUTES
  //---------------

  //Search a user whose username is like somthing
  .get('/users/username/:username', (req, res) => {
    models.User.findAll({ 
      where: { username: {like: req.params.username + '%'}},
      limit: 20
    }).then((users) => {
      res.json(users.map((user) => { return daos.UserLight(daos, user); }));
    })
  })


  .put('/users/:id', (req, res) => {
    if(Number.isInteger(Number(req.params.id))) {
      if(req.params.id == req.decoded.userId) {
        if(req.body.password !== undefined) {
          models.User.findOne({
            where: {
              id: req.params.id,
              password: md5(req.body.password)
            }
          }).then((matchingUser) => {
            if(matchingUser != null) {
              let userUpdate = {};
              let retMessage = {};

              if(req.body.newPassword !== undefined) { userUpdate.password = md5(req.body.newPassword); retMessage.password = 'Password updated'; }
              if(req.body.username !== undefined) { userUpdate.username = req.body.username; retMessage.username = 'Username updated: ' + req.body.username; }
              if(req.body.email !== undefined) { userUpdate.email = req.body.email; retMessage.email = 'Email updated: ' + req.body.email; }

              let whereClause = {};

              if(req.body.username !== undefined || req.body.email !== undefined) {
                if(req.body.username !== undefined && req.body.email !== undefined) { whereClause = {$or: { username: req.body.username, email: req.body.email}};}
                if(req.body.username !== undefined && req.body.email === undefined) { whereClause = {username: req.body.username};}
                if(req.body.username === undefined && req.body.email !== undefined) { whereClause = {email: req.body.email};}
              } else {
                whereClause = { id: -1 };
              }

              models.User.findOne({
                where: whereClause
              }).then((matchingUser) => {
                if(matchingUser == null || matchingUser.id == req.decoded.userId) {

                  let ext = null;
                  let buffer = null;
                  if(req.body.avatar != undefined) { 
                      ext = req.body.avatar.split(';')[0].match(/jpeg|png|gif/)[0];
                      let data = req.body.avatar.replace(/^data:image\/\w+;base64,/, "");
                    if(validator.isBase64(data)) {
                      buffer = new Buffer(data, 'base64');
                      let bufferSize = Buffer.byteLength(buffer, 'base64');

                      if(bufferSize < maxImageSize) {
                        userUpdate.avatar = avatarStoragePath + 'avatar_' + req.decoded.userId + '.' + ext;
                        retMessage.avatar = 'Avatar updated';
                      } else { retMessage.avatar = 'Error: avatar size: ' + bufferSize + ' bytes is more than max image size: ' + maxImageSize + ' bytes'}
                    } else { retMessage.avatar = 'Error: avatar is not a valid base64 image'; }
                  }

                  if(userUpdate.hasOwnProperty('password') || userUpdate.hasOwnProperty('username') || userUpdate.hasOwnProperty('email') || userUpdate.hasOwnProperty('avatar')) {
                    models.User.update(userUpdate, {where: { id: req.decoded.userId }}).then(() => {
                      if(userUpdate.hasOwnProperty('avatar')) {
                        let filepath = avatarStoragePath + 'avatar_' + req.decoded.userId + '.' + ext;

                        fs.stat(filepath, (err) => {
                          if(!err) { try { fs.renameSync(filepath, filepath + '.old'); } catch(e) { console.log(e); }} // need to rename the current file 

                          fs.writeFile(avatarStoragePath + 'avatar_' + req.decoded.userId + '.' + ext, buffer, (err) => {
                            if(err) {
                              try { fs.renameSync(filepath + '.old', filepath); } catch(e) { console.log(e); }
                              retMessage.avatar = 'Error: an error occured when writing file to disk';
                              return res.json({success: false, message: retMessage});
                            } else {
                              try { fs.unlinkSync(filepath + '.old') } catch(e) { /* Do nothing */}
                              return res.json({success: true, message: retMessage});
                           }
                          });
                        })                        
                      } else { return res.json({success: true, message: retMessage}); }
                    }).catch((err) => {
                      return res.status(400).json({success: false, message: err.errors.map((errMes) => { return errMes.message; })});
                    });
                  } else { return res.status(400).json({succes: false, message: retMessage}); }
                } else { return res.status(400).json({success: false, message: 'Username and / or email address already used by another account'}); }
              });
            } else { res.status(400).json({succes: false, message: "Wrong password"}); }
          });
        } else { return res.status(401).send({success: false, message: 'No password provided'}); }
      } else { return res.status(400).json({success: false, message: 'You are not allowed to update this user information'}); }
    } else { return res.status(400).json({success: false, message: 'The url id field must be an integer'}); }
  })

  // Request a friendship relation
  .post('/friendships/sendrequest', (req, res) => {
    if(req.body.targetUserId !== undefined) {
      models.User.findOne({
        where: { id: req.decoded.userId }
      }).then((originUser) => {
        if(originUser != null) {
          models.User.findOne({
            where: { id: req.body.targetUserId }
          }).then((targetUser) => {
            if(targetUser != null) {
              targetUser.getFriends({where: {id: req.decoded.userId}}).then((friends) => {
                if (friends.length == 0 ) {
                  originUser.addFriend(targetUser).then((friendRequest) => {
                    if(friendRequest.length > 0) {
                      res.status(201).json({success: true, message: 'Friend request sent!'})
                    } else { res.status(400).json({success: false, message: 'Friendship request has already been sent to this user'}); }
                  });
                } else { res.status(400).json({success: false, message: 'The target user has already sent a friendship request to the user'}); }
              })
            } else { res.status(400).json({success: false, message: 'Can\'t find target user'}); }
          })
        } else { res.status(400).json({success: false, message: 'Can\'t find current user'}); }
      })
    } else { res.status(400).json({success: false, message: 'targetUserId field is required'}); }
  })

  // Get the friendship which the user is the target (with state = false)
  .get('/friendships/received', (req, res) => {
    models.sequelize.query("SELECT * FROM Users LEFT JOIN Friendships ON Users.id = Friendships.UserId WHERE Friendships.FriendId = :userid AND Friendships.state = 0", 
      {replacements: {userid: req.decoded.userId}, type: models.sequelize.QueryTypes.SELECT, model: models.User}).then((users) => {
      return res.json(users.map((user) => {
        return daos.UserLight(daos, user);
      }));
    });
  })

  // Get the friendship requests made by the user (with state = false)
  .get('/friendships/sent', (req, res) => {
    models.sequelize.query("SELECT * FROM Users LEFT JOIN Friendships ON Users.id = Friendships.FriendId WHERE Friendships.UserId = :userid AND Friendships.state = 0", 
      {replacements: {userid: req.decoded.userId}, type: models.sequelize.QueryTypes.SELECT, model: models.User}).then((users) => {
      return res.json(users.map((user) => {
        return daos.UserLight(daos, user);
      }));
    });
  })

  // Accept a friendship request (i.e. switch state of target friendship to true)
  .put('/friendships/accpet/:id', (req, res) => {
    if(Number.isInteger(Number(req.params.id))) {
      models.sequelize.query("UPDATE Friendships SET state = 1 WHERE Friendships.UserId = :friendid AND Friendships.FriendId = :userid", 
        {replacements: {friendid: req.params.id, userid: req.decoded.userId}, type: models.sequelize.QueryTypes.UPDATE}).then(() => {
        return res.json({success: true, message: 'Friend request accepted!'});
      });
    } else { return res.status(400).json({success: false, message: 'The url id field must be an integer'}); }
  })

  // delete a friendship (validated and nor validated)
  .delete('/friendships/:id', (req, res) => {
    if(Number.isInteger(Number(req.params.id))) {
      models.sequelize.query("DELETE FROM Friendships WHERE (Friendships.UserId = :userid AND Friendships.FriendId = :friendid) OR (Friendships.UserId = :friendid AND Friendships.FriendId = :userid)",
        {replacements: {userid: req.decoded.userId, friendid: req.params.id}, type: models.sequelize.QueryTypes.DELETE}).then(() => {
          return res.json({success: true, message: 'Friendship deleted!'});
        })
    } else { return res.status(400).json({success: false, message: 'The url id field must be an integer'}); }
  })

  // Get the all friends (Users)'s position (with friendship state = true)
  .get('/friends', (req, res) => {
    let optimized = false;
    if(req.query.optimized !== undefined) {
      if(req.query.optimized.toLowerCase() == 'true') { optimized = true; } 
    }

    models.sequelize.query("(SELECT * FROM Users LEFT JOIN Friendships ON Users.id = Friendships.UserId WHERE Friendships.FriendId = :userid AND Friendships.state = 1) UNION (SELECT * FROM Users LEFT JOIN Friendships ON Users.id = Friendships.FriendId WHERE Friendships.UserId = :userid AND Friendships.state = 1)", 
      {replacements: {userid: req.decoded.userId}, type: models.sequelize.QueryTypes.SELECT, model: models.User}).then((users) => {
      return res.json(users.map((user) => { return (optimized) ? daos.UserOptimized(daos, user) : daos.User(daos, user); }));
    });
  })

  // Get the friend (User)'s position (with friendship state = true and id = id)
  .get('/friends/:id', (req, res) => {
    if(Number.isInteger(Number(req.params.id))) {
      let optimized = false;
      if(req.query.optimized !== undefined) {
        if(req.query.optimized.toLowerCase() == 'true') { optimized = true; } 
      }

      models.sequelize.query("(SELECT * FROM Users LEFT JOIN Friendships ON Users.id = Friendships.UserId WHERE Friendships.UserId = :friendid AND Friendships.FriendId = :userid AND Friendships.state = 1) UNION (SELECT * FROM Users LEFT JOIN Friendships ON Users.id = Friendships.FriendId WHERE Friendships.UserId = :userid AND Friendships.FriendId = :friendid AND Friendships.state = 1)", 
        {replacements: {userid: req.decoded.userId, friendid: req.params.id}, type: models.sequelize.QueryTypes.SELECT, model: models.User}).then((user) => {
        if(user.length > 0) { 
          return (optimized) ? res.json(daos.UserOptimized(daos, user[0])) : res.json(daos.User(daos, user[0]));
        } else { return res.status(400).json({success: false, message: 'There is no confirmed friendship with this user id'}); }
      });      
    } else { return res.status(400).json({success: false, message: 'The url id field must be an integer'}); }
  })

  .use((req, res, next) => {
    res.status(404).end();
  });


  io.sockets.on('connection', socketioJwt.authorize({
    secret: app.get('jwtSecret'),
    timeout: 15000
  })).on('authenticated', (socket) => {
    socket.user = socket.decoded_token;
    socket.friendIds = [];

    // console.log('User id: ' + socket.user.userId + ' joined to websocket server');
    models.User.update({connected: true}, {where: {id: socket.user.userId}});
    //socket.broadcast.to('channel_' + socket.user.userId).emit('friend-connect', {id: socket.user.userId});

    function updateFriendsList() {
      models.sequelize.query("(SELECT * FROM Users LEFT JOIN Friendships ON Users.id = Friendships.UserId WHERE Friendships.FriendId = :userid AND Friendships.state = 1) UNION (SELECT * FROM Users LEFT JOIN Friendships ON Users.id = Friendships.FriendId WHERE Friendships.UserId = :userid AND Friendships.state = 1)", 
        {replacements: {userid: socket.user.userId}, type: models.sequelize.QueryTypes.SELECT, model: models.User}).then((users) => {
        dbFriendIds = users.map((user) => { return user.id; });
        dbFriendIds.filter((friendId) => { return socket.friendIds.indexOf(friendId) == -1; }).forEach((friendId) => { socket.join('channel_' + friendId); }); // New friends
        socket.friendIds.filter((friendId) => { return dbFriendIds.indexOf(friendId) == -1; }).forEach((friendId) => { socket.leave('channel_' + friendId); }); // Old friends
        socket.friendIds = dbFriendIds.slice(); //copy the array
      });

      setTimeout(updateFriendsList, 60000);
    }

    updateFriendsList();

    socket.on('update-position', (position) => {
      try {
        if(position.hasOwnProperty('latitude') && position.hasOwnProperty('longitude')) {
          models.User.update({latitude: position.latitude, longitude: position.longitude}, {where: {id: socket.user.userId}}).then(() => {
            position.id = socket.user.userId;
            socket.broadcast.to('channel_' + socket.user.userId).emit('friend-update-position', position);
          });
        }
      } catch(e) { console.error(e); }
    });

    socket.on('disconnect', function(){
      models.User.update({connected: false}, {where: {id: socket.user.userId}});
      //socket.broadcast.to('channel_' + socket.user.userId).emit('friend-disconnect', {id: socket.user.userId});
    });
  });


  server.listen(port, () => {
    console.log('Express listening on port: ', port);
  });
});
