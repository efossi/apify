const express = require('express');
const bodyParser = require('body-parser');
const Apify = require('apify');
const multer = require('multer');
const upload = multer();
const app = express();



app.get('/', (req, res) => {
  res.send('Hello from Node!');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
});


//app.use(bodyParser.urlencoded({ extended: true }));
//app.use(bodyParser.json());

app.use(upload.array()); 
app.use(express.static('public'));

app.post('/apify', (req, res) => {
	
	console.log("apify");
	console.log(JSON.stringify(req.body.htmlParameter));

  if ( req && req.body && req.body.htmlParameter){
  	res.send(Apify.utils.social.parseHandlesFromHtml(req.body.htmlParameter));
  }else{
  	res.send({});	
  }
  
});