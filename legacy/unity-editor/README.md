<h1 align="center">Unity SDF Generator (Legacy)</h1>



> Unity SDF generator and SDFs smooth

> This is the archived Unity Editor version. The actively developed Web and
> desktop application lives at the repository root.

<h2><em>Demo</em></h2>

<p align="center">
  <img width="286" src="https://raw.githubusercontent.com/clarkxdy/Common/main/b/images/img_SDF-Generator/face_preview.gif">
</p>



<h2><em>How to use</em></h2>

Drag `SDF_Generator.cs` anywhere you want.

 And then you can find it here: ***Windows  > SDF Generator***

- Drag all the textures to `Sources`. Remember to set the textures to `Read/Write`.
- If `samples` is `0`, you will get a completely smooth output, otherwise the output is posterized according to the `samples`. 

- Texture with smaller white area should be on top.

<p align="center">
  <img width="286" src="https://raw.githubusercontent.com/clarkxdy/Common/main/b/images/img_SDF-Generator/sdfGenerator_editorWindow.png">
</p>



- I drew some pictures for this tool, if you are interested, you can find them here:  `images/Demo/`

  Try it and have fun !

  <p align="center">
    <img width="420" src="https://github.com/clarkxdy/Common/blob/main/b/images/img_SDF-Generator/face_source.png?raw=true">
  </p>



### Todo

- [ ] Compute shader based version
- [ ] Shader based version
- [x] Add editor
> ⚠️  RWTexture2D or  RWTexture2DArray doesn't work in Editor Mode ?

Ref: 

>http://www.codersnotes.com/notes/signed-distance-fields/
>
>https://shaderfun.com
>
>https://zhuanlan.zhihu.com/p/337944099
