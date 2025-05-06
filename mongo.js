const { MongoClient } = require('mongodb');

const url = 'mongodb://localhost:27017';

const dbName = 'myDatabase';

const client = new MongoClient(url, { useUnifiedTopology: true });

client.connect((err) => {
  if (err) {
    console.error(`Error connecting to MongoDB: ${err}`);
    return;
  }

  client.close();
});