var httpProxy = require('http-proxy'),
    http = require('http'),
    url = require('url'),
    glob = require('glob'),
    request = require('request'),
    https = require('https'),
    fs = require('fs'),
    secrets = require('./config/secrets'),
    path = require('path'),
    nodemailer = require('nodemailer'),
    previousErrorTime = new Date() - 3600000,
    constants = require('constants'),
    tls = require('tls');

   /**
    * Set nodemailer transporter
    */
   var mailer = nodemailer.createTransport(secrets.smtpServer);
   
    /**
     * Before we begin, lets set the environment variable
     * We'll Look for a valid NODE_ENV variable and if one cannot be found load the development NODE_ENV
     */
    glob('./config/env/' + process.env.NODE_ENV + '.json', {
        sync: true
    }, function(err, environmentFiles) {
    	console.log();
    	if (!environmentFiles.length) {
    		if(process.env.NODE_ENV) {
    			console.log('\x1b[31m', 'No configuration file found for "' + process.env.NODE_ENV + '" environment using development instead');
    		} else {
    			console.log('\x1b[31m', 'NODE_ENV is not defined! Using default development environment');
    		}

    		process.env.NODE_ENV = 'development';
    	} else {
    		console.log('\x1b[7m', 'Application loaded using the "' + process.env.NODE_ENV + '" environment configuration');
    	}
    	console.log('\x1b[0m');
    });

// Get production or development config
var config = require('./config/env/' + process.env.NODE_ENV);

if (config.startHttpProxy) {
   // Create http proxy
   var proxy = httpProxy.createProxy({target: { protocol: 'http:'}});
   
   // Start http server
   var httpServer = http.createServer(function(req, res) {
     // proxy requests to the target url that matches the current request url
     proxy.web(req, res, {
       target: config.options[req.headers.host]
     });
   });
   
   proxy.on('error', function (err, req, res) {
      // check previous time error was sent by email
      var currentErrorTime = new Date();
      var diff = currentErrorTime - previousErrorTime;
      
      if (diff > 3600000) {
         previousErrorTime = currentErrorTime;
         
         // check if error thrown is a connection reset error, indicating the application server is down
         if ((err instanceof Array && err.indexOf("ECONNRESET") > -1) || (err instanceof String && err === "ECONNREFUSED")) {

            mailer.sendMail({
                  from: secrets.smtpServer.auth.user,
                  to: secrets.mailingAddressRecipient,
                  subject: 'Proxy Error',
                  text: 'Site seems to be down: ' + req.headers.host + ', Error: ' + err
               },
               function(error, info){
                  if(error){
                        console.log(error);
                  }else{
                        console.log('Message sent: ' + info.response);
                  }
               }
            );
         }     
      }
      console.log("Error:", err);
      
      res.end();
    });
   
   httpServer.on('listening',function(){
        console.log('ok, http server is running on port ' + config.mainPort);
    });
   
   httpServer.listen(config.mainPort);
}

// set certicicates and start SSL server
if (config.startHttpsProxy) {
    
    // prepare config with ssl keys and settings
    var sslconfig = {};
    if(config.hasOwnProperty('pfx_file')){
        sslconfig.pfx = fs.readFileSync(path.resolve(__dirname, config.pfx_file), 'UTF-8');
    }
    else if (config.hasOwnProperty('key_file') && config.hasOwnProperty('cert_file')){
        sslconfig.key = fs.readFileSync(path.resolve(__dirname, config.key_file), 'UTF-8');
        sslconfig.cert = fs.readFileSync(path.resolve(__dirname, config.cert_file), 'UTF-8');
    }
    
    if(config.hasOwnProperty('ca_file') && config.hasOwnProperty('ca2_file')){
              sslconfig.ca = [
			      fs.readFileSync(path.resolve(__dirname, config.ca_file), 'UTF-8'),
			      fs.readFileSync(path.resolve(__dirname, config.ca2_file), 'UTF-8')
			     ]
   } else if(config.hasOwnProperty('ca_file')){
              sslconfig.ca = fs.readFileSync(path.resolve(__dirname, config.ca_file), 'UTF-8');
   }
    
    // set passphrase in config
    if(secrets.certificate.passphrase) {
      sslconfig.passphrase = secrets.certificate.passphrase;
    }
    
    // Setting for self signed certificate
    sslconfig.rejectUnauthorized = true;
    sslconfig.secure = true;
    sslconfig.secureProtocol = 'SSLv23_method';
    sslconfig.secureOptions = constants.SSL_OP_NO_SSLv3;
    
    // create proxy for SSL requests
    var proxySSL = httpProxy.createProxy();

    // Create https server to listen to requests
    var sslServer = https.createServer(sslconfig, function(req, res) {
      // proxy the requests to the right domain
      proxySSL.web(req, res,
         {
            target: config.options[req.headers.host],
            ssl: sslconfig,
            secure: false,
            xfwd: true,
            agent: new http.Agent({ maxSockets: Infinity })
         });
    });
       
   proxySSL.on('error', function (err, req, res) {
      // check previous time error was sent by email
      var currentErrorTime = new Date();
      var diff = currentErrorTime - previousErrorTime;
      
      if (diff > 3600000) {
         previousErrorTime = currentErrorTime;
      
         // check if error thrown is a connection reset error, indicating the application server is down
         if ((err instanceof Array && err.indexOf("ECONNRESET") > -1) || (err instanceof String && err === "ECONNREFUSED")) {

            mailer.sendMail({
                  from: secrets.smtpServer.auth.user,
                  to: secrets.mailingAddressRecipient,
                  subject: 'Proxy Error',
                  text: 'Site seems to be down: ' + req.headers.host + ', Error: ' + err
               },
               function(error, info){
                  if(error){
                        console.log(error);
                  }else{
                        console.log('Message sent: ' + info.response);
                  }
               }
            );
         } 
      }
      console.log("Error:", err);
      
      res.end();
    });
   
    // Add listening to server
    sslServer.on('listening',function(){
        console.log('ok, https server is running on port ' + config.sslport);
    });
    
    // Start server
    sslServer.listen(config.sslport);
}