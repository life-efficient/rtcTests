import React from 'react';
import logo from './logo.svg';
import './App.css';
import TestUI from "./test_files/TestUI"
import Amplify from "aws-amplify"

Amplify.configure({
  Auth: {
        identityPoolId: 'eu-west-2:a9b6789c-da76-4a3e-ae38-93373981ff11',
        region: 'eu-west-2',
        userPoolId: 'eu-west-2_XRYfK4o2B',
        userPoolWebClientId: '12rljt0gbcrc780r5tdeoctdvk',
        mandatorySignIn: true
  }
})


function App() {
  return (
    <div className="App">
      hello
     	<TestUI/>
    </div>
  );
}

export default App;
