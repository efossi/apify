const express = require('express');
const bodyParser = require('body-parser');
const Apify = require('apify');

const app = express();



app.get('/', (req, res) => {
  res.send('Hello from Node!');
});

const PORT = process.env.PORT || 8090;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
});


//app.use(bodyParser.urlencoded({ extended: true }));

app.use(bodyParser.json());

app.post('/apify', (req, res) => {
	
	console.log("apify");
	console.log(req.body);

  // console.log({
  //   name: req.body.name,
  //   message: req.body.message
  // });
  if ( req && req.body && req.body.html){
  	res.send(Apify.utils.social.parseHandlesFromHtml(req.body.html));
  }else{
  	res.send({});	
  }
  
});