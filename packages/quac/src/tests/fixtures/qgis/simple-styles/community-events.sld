<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor xmlns="http://www.opengis.net/sld" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1.0" xmlns:ogc="http://www.opengis.net/ogc" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.1.0/StyledLayerDescriptor.xsd" xmlns:se="http://www.opengis.net/se">
 <NamedLayer>
  <se:Name>Community_Events</se:Name>
  <UserStyle>
   <se:Name>default</se:Name>
   <se:FeatureTypeStyle>
    <se:Rule>
     <se:Name>Festival</se:Name>
     <se:Description>
      <se:Title>Festival</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>event_type</ogc:PropertyName>
       <ogc:Literal>Festival</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:PointSymbolizer>
      <se:Graphic>
       <se:Mark>
        <se:WellKnownName>star</se:WellKnownName>
        <se:Fill>
         <se:SvgParameter name="fill">#cc00cc</se:SvgParameter>
        </se:Fill>
        <se:Stroke>
         <se:SvgParameter name="stroke">#880088</se:SvgParameter>
         <se:SvgParameter name="stroke-width">0.5</se:SvgParameter>
        </se:Stroke>
       </se:Mark>
       <se:Size>18</se:Size>
      </se:Graphic>
     </se:PointSymbolizer>
    </se:Rule>
    <se:Rule>
     <se:Name>Market</se:Name>
     <se:Description>
      <se:Title>Market</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>event_type</ogc:PropertyName>
       <ogc:Literal>Market</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:PointSymbolizer>
      <se:Graphic>
       <se:Mark>
        <se:WellKnownName>star</se:WellKnownName>
        <se:Fill>
         <se:SvgParameter name="fill">#ff7700</se:SvgParameter>
        </se:Fill>
        <se:Stroke>
         <se:SvgParameter name="stroke">#cc5500</se:SvgParameter>
         <se:SvgParameter name="stroke-width">0.5</se:SvgParameter>
        </se:Stroke>
       </se:Mark>
       <se:Size>16</se:Size>
      </se:Graphic>
     </se:PointSymbolizer>
    </se:Rule>
    <se:Rule>
     <se:Name>Sports</se:Name>
     <se:Description>
      <se:Title>Sports</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>event_type</ogc:PropertyName>
       <ogc:Literal>Sports</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:PointSymbolizer>
      <se:Graphic>
       <se:Mark>
        <se:WellKnownName>star</se:WellKnownName>
        <se:Fill>
         <se:SvgParameter name="fill">#0055cc</se:SvgParameter>
        </se:Fill>
        <se:Stroke>
         <se:SvgParameter name="stroke">#003388</se:SvgParameter>
         <se:SvgParameter name="stroke-width">0.5</se:SvgParameter>
        </se:Stroke>
       </se:Mark>
       <se:Size>16</se:Size>
      </se:Graphic>
     </se:PointSymbolizer>
    </se:Rule>
    <se:Rule>
     <se:Name>Concert</se:Name>
     <se:Description>
      <se:Title>Concert</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>event_type</ogc:PropertyName>
       <ogc:Literal>Concert</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:PointSymbolizer>
      <se:Graphic>
       <se:Mark>
        <se:WellKnownName>star</se:WellKnownName>
        <se:Fill>
         <se:SvgParameter name="fill">#00aa44</se:SvgParameter>
        </se:Fill>
        <se:Stroke>
         <se:SvgParameter name="stroke">#007722</se:SvgParameter>
         <se:SvgParameter name="stroke-width">0.5</se:SvgParameter>
        </se:Stroke>
       </se:Mark>
       <se:Size>16</se:Size>
      </se:Graphic>
     </se:PointSymbolizer>
    </se:Rule>
   </se:FeatureTypeStyle>
  </UserStyle>
 </NamedLayer>
</StyledLayerDescriptor>
