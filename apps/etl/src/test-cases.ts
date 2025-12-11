const inputOne = `
<div id="root">
  <div id="child">
    <div id="4">lorem</div>
  </div>
</div>
`;

const expectedOutputOne = `
<div id="root">
  <div id="child">
    <div id="4">lorem</div>
  </div>
</div>
`

const inputTwo = `
<div id="root">
  <div id="child">
    <div>
        <div id="4">lorem</div>
    </div>
  </div>
</div>
`;

const expectedOutputTwo = `
<div id="root">
  <div id="child">
    <div></div>
    <div id="4">lorem</div>
    <div></div>
  </div>
</div>
`

const inputThree = `
<div id="root">
  <div id="child">
    <div>
        <div id="3">lorem</div>
        <div id="4">lorem</div>
        <div id="5">lorem</div>
    </div>
  </div>
</div>
`;

const expectedOutputThree = `
<div id="root">
  <div id="child">
    <div>
        <div id="3">lorem</div>
    </div>
    <div id="4">lorem</div>
    <div>
        <div id="5">lorem</div>
    </div>
  </div>
</div>
`

const inputFour = `
<div id="root">
  <div id="child">
    <div>
        <div id="3">lorem</div>
        <table>
            <tr>
                <td>
                    <div id="4">lorem</div>
                </td>
                <td>
                    <div id="5">lorem</div>
                    <div id="6">lorem</div>
                </td>
                <td id="7">lorem</td>
            </tr>
            <tr>
                <td id="8">lorem</td>
            </tr>
        </table>
    </div>
  </div>
</div>
`;

const expectedOutputFour = `
<div id="root">
  <div id="child">
    <div>
        <div id="3">lorem</div>
        <table>
            <tr>
                <td></td>
            </tr>
        </table>
    </div>
    <div id="4">lorem</div>
    <div>
        </table>
            </tr>
                <td></td>
                <td>
                    <div id="5">lorem</div>
                    <div id="6">lorem</div>
                </td>
                <td id="7">lorem</td>
            </tr>
            <tr>
                <td id="8">lorem</td>
            </tr>
        </table>
    </div>
  </div>
</div>
`;


export const TEST_CASES = [
    {
        input: inputOne,
        expectedOutput: expectedOutputOne,
    },
    {
        input: inputTwo,
        expectedOutput: expectedOutputTwo,
    },
    {
        input: inputThree,
        expectedOutput: expectedOutputThree,
    },
    {
        input: inputFour,
        expectedOutput: expectedOutputFour,
    },
]